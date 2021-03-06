import {
  GraphQLError
} from "graphql/error";

import {
  log
} from "../../../lib";
import {
  Message,
  r
} from "../../models";
import serviceMap from "../lib/services";

import {
  getSendBeforeTimeUtc
} from "../../../lib/timezones";

const JOBS_SAME_PROCESS = !!(
  process.env.JOBS_SAME_PROCESS || global.JOBS_SAME_PROCESS
);

export const sendMessage = async (message, campaignContactId, loaders) => {
  const contact = await loaders.campaignContact.load(campaignContactId);
  const campaign = await loaders.campaign.load(contact.campaign_id);
  if (
    contact.assignment_id !== parseInt(message.assignmentId) ||
    campaign.is_archived
  ) {
    throw new GraphQLError({
      status: 400,
      message: "Your assignment has changed"
    });
  }
  const organization = await r
    .table("campaign")
    .get(contact.campaign_id)
    .eqJoin("organization_id", r.table("organization"))("right");

  const orgFeatures = JSON.parse(organization.features || "{}");

  const optOut = await r
    .table("opt_out")
    .getAll(contact.cell, {
      index: "cell"
    })
    .filter({
      organization_id: organization.id
    })
    .limit(1)(0)
    .default(null);
  if (optOut) {
    throw new GraphQLError({
      status: 400,
      message: "Skipped sending because this contact was already opted out"
    });
  }

  // const zipData = await r.table('zip_code')
  //   .get(contact.zip)
  //   .default(null)

  // const config = {
  //   textingHoursEnforced: organization.texting_hours_enforced,
  //   textingHoursStart: organization.texting_hours_start,
  //   textingHoursEnd: organization.texting_hours_end,
  // }
  // const offsetData = zipData ? { offset: zipData.timezone_offset, hasDST: zipData.has_dst } : null
  // if (!isBetweenTextingHours(offsetData, config)) {
  //   throw new GraphQLError({
  //     status: 400,
  //     message: "Skipped sending because it's now outside texting hours for this contact"
  //   })
  // }

  const {
    contactNumber,
    text
  } = message;

  if (text.length > (process.env.MAX_MESSAGE_LENGTH || 99999)) {
    throw new GraphQLError({
      status: 400,
      message: "Message was longer than the limit"
    });
  }

  const replaceCurlyApostrophes = rawText =>
    rawText.replace(/[\u2018\u2019]/g, "'");

  let contactTimezone = {};
  if (contact.timezone_offset) {
    // couldn't look up the timezone by zip record, so we load it
    // from the campaign_contact directly if it's there
    const [offset, hasDST] = contact.timezone_offset.split("_");
    contactTimezone.offset = parseInt(offset, 10);
    contactTimezone.hasDST = hasDST === "1";
  }

  const sendBefore = getSendBeforeTimeUtc(
    contactTimezone, {
      textingHoursEnd: organization.texting_hours_end,
      textingHoursEnforced: organization.texting_hours_enforced
    }, {
      textingHoursEnd: campaign.texting_hours_end,
      overrideOrganizationTextingHours: campaign.override_organization_texting_hours,
      textingHoursEnforced: campaign.texting_hours_enforced,
      timezone: campaign.timezone
    }
  );

  const sendBeforeDate = sendBefore ? sendBefore.toDate() : null;

  if (sendBeforeDate && sendBeforeDate <= Date.now()) {
    throw new GraphQLError({
      status: 400,
      message: "Outside permitted texting time for this recipient"
    });
  }

  const messageInstance = new Message({
    text: replaceCurlyApostrophes(text),
    contact_number: contactNumber,
    user_number: "",
    assignment_id: message.assignmentId,
    send_status: JOBS_SAME_PROCESS ? "SENDING" : "QUEUED",
    service: orgFeatures.service || process.env.DEFAULT_SERVICE || "",
    is_from_contact: false,
    queued_at: new Date(),
    send_before: sendBeforeDate
  });

  await messageInstance.save();
  const service =
    serviceMap[
      messageInstance.service ||
      process.env.DEFAULT_SERVICE ||
      global.DEFAULT_SERVICE
    ];

  contact.updated_at = "now()";

  if (
    contact.message_status === "needsResponse" ||
    contact.message_status === "convo"
  ) {
    contact.message_status = "convo";
  } else {
    contact.message_status = "messaged";
  }

  await contact.save();

  log.info(
    `Sending (${service}): ${messageInstance.user_number} -> ${messageInstance.contact_number}\nMessage: ${messageInstance.text}`
  );

  service.sendMessage(messageInstance, contact);
  return contact;
};