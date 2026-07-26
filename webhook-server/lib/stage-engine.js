"use strict";

// Flow E — the stage engine
// (docs/superpowers/specs/2026-07-24-flow-e-stage-engine-design.md).
// Reacts to Client Pipeline changes surfaced by Graph change
// notifications: one delta fetch per notification batch, a Stage vs
// PreviousStage comparison to detect real transitions (and to no-op the
// self-triggered notification caused by this engine's own writes), an
// EventKey idempotency check against the Pipeline Activity list, then a
// per-stage handler. Phase 1 implements only the `Consult Held` case.

function buildEventKey(itemId, fields) {
  return `${itemId}|${fields.Stage}|${fields.TimelineVersion ?? 0}`;
}

function createStageEngine({
  sharepointClient,
  activityClient,
  itemLock,
  mailer,
  michaelEmail,
}) {
  // In-memory only: a restart falls back to a full baseline sync, which is
  // safe — the Stage/PreviousStage guard and EventKey check make
  // reprocessing old items a no-op.
  let deltaLink = null;

  // Consult Held (spec §4): the questionnaire send is stubbed as a manual
  // task for Michael — the intake Microsoft Form (gap G2) and the
  // where-to-file-responses question are unresolved, and the Matter Tasks
  // list does not exist yet, so the "intake reminder task" is delivered as
  // an email until those land.
  async function handleConsultHeld(item) {
    const f = item.fields;
    const name =
      `${f.FirstName || ""} ${f.LastName || ""}`.trim() ||
      f.Title ||
      `item ${item.id}`;
    await mailer.sendEmail({
      to: michaelEmail,
      subject: `[Pipeline] Consult held — send intake questionnaire to ${name}`,
      text: [
        `Stage moved to "Consult Held" for ${name} <${f.Email || "no email"}>.`,
        ``,
        `Action needed (automated questionnaire send not built yet — G2 pending):`,
        `  1. Send the intake questionnaire.`,
        `  2. Note it on the pipeline item once sent.`,
        ``,
        `Pipeline item: ${item.webUrl || `item ${item.id}`}`,
      ].join("\n"),
    });
  }

  // Later phases add cases here (Fee Agreement Sent, Engaged (Accepted),
  // Signing Scheduled, Signed & Paid, Declined / Not a Fit).
  const CASE_HANDLERS = {
    "Consult Held": handleConsultHeld,
  };

  async function processItem(item) {
    const fields = item.fields || {};
    // Self-update guard: equal means either nothing changed or this
    // engine's own last write already advanced PreviousStage (spec §2.1).
    if (!fields.Stage || fields.Stage === fields.PreviousStage) {
      return { action: "skip", itemId: item.id };
    }
    const handler = CASE_HANDLERS[fields.Stage];
    if (!handler) {
      return { action: "unhandled", itemId: item.id, stage: fields.Stage };
    }
    const eventKey = buildEventKey(item.id, fields);
    if (await activityClient.findSuccessByEventKey(eventKey)) {
      // Already processed, but if PreviousStage wasn't advanced due to an
      // updatePipelineItem failure, re-attempt the advance to self-heal.
      await sharepointClient.updatePipelineItem(item.id, {
        PreviousStage: fields.Stage,
        StageChangedAt: new Date().toISOString(),
      });
      return { action: "no-op-duplicate", itemId: item.id, eventKey };
    }
    try {
      await handler(item);
    } catch (err) {
      // A partial failure must not write the Success record — the next
      // notification for this item retries the whole case.
      await activityClient.recordActivity({
        pipelineItemId: item.id,
        eventType: `stage:${fields.Stage}`,
        eventKey,
        summary: `Stage "${fields.Stage}" processing failed`,
        outcome: "Failed",
        errorDetails: String(err.message || err),
      });
      try {
        await mailer.sendEmail({
          to: michaelEmail,
          subject: `[ALERT] Stage engine failed — ${fields.Stage} (item ${item.id})`,
          text: [
            `Processing the "${fields.Stage}" stage failed for pipeline item ${item.id}.`,
            ``,
            `Error: ${String(err.message || err)}`,
            ``,
            `Check Railway logs. The transition will retry on the next change`,
            `notification for this item.`,
          ].join("\n"),
        });
      } catch {
        // Alert email send failed; don't compound the error. The Failed
        // activity record was written; manual inspection is needed.
      }
      return {
        action: "failed",
        itemId: item.id,
        eventKey,
        error: err.message,
      };
    }
    await activityClient.recordActivity({
      pipelineItemId: item.id,
      eventType: `stage:${fields.Stage}`,
      eventKey,
      summary: `Stage "${fields.Stage}" processed`,
      outcome: "Success",
    });
    // Last step: advance PreviousStage so the self-triggered notification
    // from this write sees Stage === PreviousStage and no-ops.
    await sharepointClient.updatePipelineItem(item.id, {
      PreviousStage: fields.Stage,
      StageChangedAt: new Date().toISOString(),
    });
    return { action: "processed", itemId: item.id, eventKey };
  }

  // Entry point for the webhook handler: one delta fetch per notification
  // batch (notifications carry no data), then per-item processing behind
  // the per-item lock.
  async function processNotifications() {
    let result = await sharepointClient.fetchListDelta(deltaLink);
    if (result.reset) {
      deltaLink = null;
      result = await sharepointClient.fetchListDelta(null);
    }
    deltaLink = result.deltaLink;
    const outcomes = [];
    for (const item of result.items) {
      try {
        outcomes.push(
          await itemLock.withItemLock(item.id, () => processItem(item)),
        );
      } catch (err) {
        const errorMsg = String(err.message || err);
        console.error(`[stage-engine] item ${item.id} failed:`, errorMsg);
        outcomes.push({
          action: "error",
          itemId: item.id,
          error: errorMsg,
        });
      }
    }
    return outcomes;
  }

  return { processNotifications, processItem };
}

module.exports = { createStageEngine, buildEventKey };
