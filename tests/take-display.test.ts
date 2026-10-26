import assert from "node:assert/strict";
import { test } from "node:test";
import { heardCaption, visibleUserTake } from "../src/lib/take-display";

test("a saved take stays off the You lane until it is shown as the previous take", () => {
  const saved = { id: "saved" };
  const session = { id: "session" };
  assert.deepEqual(visibleUserTake({ session: null, saved, showSaved: false }), {
    take: null,
    previous: false,
  });
  assert.deepEqual(visibleUserTake({ session: null, saved: null, showSaved: true }), {
    take: null,
    previous: false,
  });
  assert.deepEqual(visibleUserTake({ session: null, saved, showSaved: true }), {
    take: saved,
    previous: true,
  });
  assert.deepEqual(visibleUserTake({ session, saved, showSaved: true }), {
    take: session,
    previous: false,
  });
});

test("Heard follows the selected voice", () => {
  assert.equal(
    heardCaption({
      track: "model",
      referenceText: "果果今年十三岁。",
      userText: "果果",
      previous: true,
    }),
    "Heard: 果果今年十三岁。",
  );
  assert.equal(
    heardCaption({
      track: "yours",
      referenceText: "果果今年十三岁。",
      userText: "",
      previous: false,
    }),
    "",
  );
  assert.equal(
    heardCaption({
      track: "yours",
      referenceText: "果果今年十三岁。",
      userText: "果果",
      previous: false,
    }),
    "Heard: 果果",
  );
  assert.equal(
    heardCaption({
      track: "yours",
      referenceText: "果果今年十三岁。",
      userText: "果果",
      previous: true,
    }),
    "Previous take · Heard: 果果",
  );
});
