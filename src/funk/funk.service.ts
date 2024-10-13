import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { OrganisationDocument } from 'src/organisation/schemas/organisation.schema';
import { UserDocument } from 'src/user/schemas/user.schema';
import { FunkItemEventBulk as FunkItemEventBulk } from './schemas/funk-item-event-bulk.schema';
import {
  FunkItemEvent,
  FunkItemEventDocument,
  FunkItemEventType,
} from './schemas/funk-item-event.schema';
import { FunkItem, FunkItemDocument } from './schemas/funlk-item.schema';

@Injectable()
export class FunkService {
  constructor(
    @InjectModel(FunkItem.name)
    private funkItemModel: Model<FunkItem>,
    @InjectModel(FunkItemEvent.name)
    private funkItemEventModel: Model<FunkItemEvent>,
    @InjectModel(FunkItemEventBulk.name)
    private funkItemEventBulkModel: Model<FunkItemEventBulk>,
  ) {}

  async getFunkItems(organisationId: mongoose.Types.ObjectId) {
    return this.funkItemModel
      .find({
        organisation: organisationId,
      })
      .exec();
  }

  async getExpandedFunkItems(organisationId: mongoose.Types.ObjectId) {
    const funkItems = await this.getFunkItems(organisationId);
    return Promise.all(
      funkItems.map(async (item) => {
        const lastEvent = await this.getLastEventForItem(item);

        return {
          ...item.toObject(),
          lastEvent,
        };
      }),
    );
  }

  async getFunkItemByDeviceId(
    organisationId: mongoose.Types.ObjectId,
    deviceId: string,
  ) {
    return (
      this.funkItemModel
        .findOne({
          organisation: organisationId,
          deviceId,
        })
        // .populate('lastUsedBy')
        .exec()
    );
  }

  async createFunkItem(
    organisationId: mongoose.Types.ObjectId,
    data: FunkItem,
  ) {
    if (await this.getFunkItemByDeviceId(organisationId, data.deviceId)) {
      Logger.warn(`Funk item with deviceId ${data.deviceId} already exists`);
      return;
    }

    const item = new this.funkItemModel(data);
    return item.save();
  }

  async createFunkItemEvent(data: FunkItemEvent) {
    const event = new this.funkItemEventModel(data);
    return event.save();
  }

  async getFunkItemEvents(itemDoc: FunkItemDocument) {
    return this.funkItemEventModel
      .find({ funkItem: itemDoc._id })
      .populate('user')
      .exec();
  }

  async getLastEventForItem(
    itemDoc: FunkItemDocument,
  ): Promise<FunkItemEventDocument | null> {
    return this.funkItemEventModel
      .findOne({ funkItem: itemDoc._id })
      .sort({ date: -1 })
      .populate('user')
      .exec();
  }

  async bulkCreateFunkItemEvents(
    data: {
      deviceIds: string[];
      batteryCount: number;
      eventType: FunkItemEventType;
    },
    user: UserDocument,
    organisation: OrganisationDocument,
    date: Date,
  ): Promise<void> {
    const items = await Promise.all(
      data.deviceIds.map(async (deviceId) => {
        let item = await this.getFunkItemByDeviceId(organisation._id, deviceId);
        if (!item) {
          Logger.log(
            `Creating Funk item with deviceId ${deviceId}, as it does not exist`,
          );
          item = await this.createFunkItem(organisation._id, {
            deviceId,
            organisation,
          });
        }

        return item;
      }),
    );

    const events = await Promise.all(
      items.map((item) =>
        this.createFunkItemEvent({
          date,
          funkItem: item,
          user,
          type: data.eventType,
        }),
      ),
    );

    const bulk = new this.funkItemEventBulkModel({
      funkItemEvents: events,
      batteryCount: data.batteryCount,
      eventType: data.eventType,
      user,
      organisation,
      date,
    });
    await bulk.save();
  }

  async getFunkItemEventBulks(
    organisationId: mongoose.Types.ObjectId,
  ): Promise<FunkItemEventBulk[]> {
    return this.funkItemEventBulkModel
      .find({ organisation: organisationId })
      .populate({
        path: 'funkItemEvents',
        populate: {
          path: 'funkItem',
        },
      })
      .populate('user')
      .exec();
  }

  async exportFunkItemEventBulksAsCsv(
    organisationId: mongoose.Types.ObjectId,
  ): Promise<string> {
    const bulks = await this.getFunkItemEventBulks(organisationId);

    let csv = 'date,eventType,batteryCount,user,deviceIds\n';

    for (const bulk of bulks) {
      csv += `${bulk.date.toISOString()},${bulk.eventType},${bulk.batteryCount},"${bulk.user.firstName} ${bulk.user.lastName} (${bulk.user.email})","${bulk.funkItemEvents
        .map((event) => event.funkItem.deviceId)
        .join(', ')}"\n`;
    }

    return csv;
  }
}