"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMailer } = require("./mailer");

function fakeGraphClient(responder) {
  const calls = [];
  return {
    calls,
    graphFetch: async (path, options = {}) => {
      calls.push({ path, options });
      if (responder) return responder(path, options);
      return null;
    },
  };
}

test("sendEmail POSTs to the sendMail endpoint for the configured mailbox", async () => {
  const graphClient = fakeGraphClient();
  const mailer = createMailer({
    graphClient,
    fromMailbox: "michael@lehr-law.com",
  });

  await mailer.sendEmail({
    to: "michael@lehr-law.com",
    subject: "Test",
    text: "hi",
    html: "<p>hi</p>",
  });

  assert.equal(graphClient.calls[0].path, "/users/michael%40lehr-law.com/sendMail");
  assert.equal(graphClient.calls[0].options.method, "POST");
  const body = JSON.parse(graphClient.calls[0].options.body);
  assert.equal(body.message.subject, "Test");
  assert.equal(body.message.body.contentType, "HTML");
  assert.equal(body.message.body.content, "<p>hi</p>");
  assert.equal(body.message.toRecipients[0].emailAddress.address, "michael@lehr-law.com");
  assert.equal(body.saveToSentItems, false);
});

test("sendEmail falls back to plain text content when html is not provided", async () => {
  const graphClient = fakeGraphClient();
  const mailer = createMailer({
    graphClient,
    fromMailbox: "michael@lehr-law.com",
  });

  await mailer.sendEmail({
    to: "michael@lehr-law.com",
    subject: "Test",
    text: "plain text",
  });

  const body = JSON.parse(graphClient.calls[0].options.body);
  assert.equal(body.message.body.content, "plain text");
});

test("sendEmail catches Graph failures instead of throwing", async () => {
  const graphClient = fakeGraphClient(() => {
    throw new Error("[graph] POST /users/x/sendMail failed: 403 Forbidden");
  });
  const mailer = createMailer({
    graphClient,
    fromMailbox: "michael@lehr-law.com",
  });

  await assert.doesNotReject(() =>
    mailer.sendEmail({ to: "michael@lehr-law.com", subject: "Test", text: "hi" }),
  );
});
