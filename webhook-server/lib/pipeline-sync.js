"use strict";

const { mapLabelToCode } = require("./product-contract");

function newestFirst(items) {
  return [...items].sort(
    (a, b) =>
      new Date(b.fields.InquiryReceivedAt) -
      new Date(a.fields.InquiryReceivedAt),
  );
}

async function flagMultipleMatches(sharepointClient, openItems) {
  const newest = newestFirst(openItems)[0];
  const notes =
    `${newest.fields.Notes || ""}\n[NEEDS REVIEW: multiple open matters for this email]`.trim();
  await sharepointClient.updatePipelineItem(newest.id, { Notes: notes });
  return { ok: true, action: "flagged-multiple", itemId: newest.id };
}

function createPipelineSync({ sharepointClient }) {
  async function syncTallyMessage({
    submissionId,
    firstName,
    lastName,
    email,
    phone,
    service,
  }) {
    const openItems = await sharepointClient.findOpenItemByEmail(email);

    if (openItems.length > 1) {
      return flagMultipleMatches(sharepointClient, openItems);
    }

    if (openItems.length === 1) {
      const item = openItems[0];
      if (item.fields.TallySubmissionID === submissionId) {
        return { ok: true, action: "no-op-duplicate", itemId: item.id };
      }
      await sharepointClient.updatePipelineItem(item.id, {
        FirstName: firstName,
        LastName: lastName,
        Phone: phone,
        DesiredProductLabel: service,
        DesiredProductCode: mapLabelToCode(service),
        TallySubmissionID: submissionId,
      });
      return { ok: true, action: "updated", itemId: item.id };
    }

    const created = await sharepointClient.createPipelineItem({
      Title: `${lastName}, ${firstName} — ${service}`,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Phone: phone,
      Source: "Website Message",
      DesiredProductLabel: service,
      DesiredProductCode: mapLabelToCode(service),
      TallySubmissionID: submissionId,
      Stage: "New Inquiry",
      InquiryReceivedAt: new Date().toISOString(),
    });
    return { ok: true, action: "created", itemId: created.id };
  }

  async function syncCalendlyBooking({
    eventUri,
    name,
    email,
    startTime,
    endTime,
    timeZone,
    cancelUrl,
    rescheduleUrl,
  }) {
    const openItems = await sharepointClient.findOpenItemByEmail(email);

    if (openItems.length > 1) {
      return flagMultipleMatches(sharepointClient, openItems);
    }

    const bookingFields = {
      Stage: "Consult Scheduled",
      ConsultStart: startTime,
      ConsultEnd: endTime,
      ConsultTimeZone: timeZone,
      CalendlyEventURI: eventUri,
      Notes: `Reschedule: ${rescheduleUrl}\nCancel: ${cancelUrl}`,
    };

    if (openItems.length === 1) {
      const item = openItems[0];
      if (item.fields.CalendlyEventURI === eventUri) {
        return { ok: true, action: "no-op-duplicate", itemId: item.id };
      }
      await sharepointClient.updatePipelineItem(item.id, bookingFields);
      return { ok: true, action: "updated", itemId: item.id };
    }

    const [firstName, ...rest] = name.split(" ");
    const lastName = rest.join(" ") || "(unknown)";
    const created = await sharepointClient.createPipelineItem({
      Title: `${lastName}, ${firstName} — Consultation`,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Source: "Booking",
      InquiryReceivedAt: new Date().toISOString(),
      ...bookingFields,
    });
    return { ok: true, action: "created", itemId: created.id };
  }

  async function syncCalendlyCancellation({ eventUri }) {
    const item = await sharepointClient.findItemByCalendlyEventUri(eventUri);
    if (!item) {
      return { ok: true, action: "no-matching-item" };
    }
    await sharepointClient.updatePipelineItem(item.id, {
      Stage: "Consult Cancelled",
    });
    return { ok: true, action: "cancelled", itemId: item.id };
  }

  return { syncTallyMessage, syncCalendlyBooking, syncCalendlyCancellation };
}

module.exports = { createPipelineSync };
