import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAmbassadorRegistration } from "../netlify/lib/postgres-ingest.mjs";

test("maps the Hebrew ambassador registration form into campaign ambassador fields", () => {
  const record = normalizeAmbassadorRegistration({
    "חותמת זמן": "8/23/2026 09:15:00",
    "שם מלא של השגריר": "בדיקת שגריר",
    "שם השגריר שהפנה אותך": "שגריר מפנה",
    "כתובת מייל": "Test.Ambassador@example.com",
    "מספר טלפון": "050-1234567",
    "האם כבר היית שגריר בעבר?": "כן",
    "איך הגעת לקישור הרשמה לשגרירים?": "וואטסאפ",
    "האם את/ה מעל גיל 18?": "לא",
    "אני יודע/ת שזה לא הקישור הרשמה לאריזות": "יודע/ת",
    "אני מסכימ/ה לתקנון": "מסכימ/ה",
  });

  assert.equal(record.fullName, "בדיקת שגריר");
  assert.equal(record.email, "test.ambassador@example.com");
  assert.equal(record.nickname, "test-ambassador");
  assert.equal(record.phone, "050-1234567");
  assert.equal(record.referredBy, "שגריר מפנה");
  assert.equal(record.wasAmbassadorBefore, true);
  assert.equal(record.registrationSource, "וואטסאפ");
  assert.equal(record.isOver18, false);
  assert.equal(record.understandsNotPacking, true);
  assert.equal(record.termsAccepted, true);
});

test("does not derive a nickname from an invalid email", () => {
  const record = normalizeAmbassadorRegistration({
    "שם מלא של השגריר": "רשומה לא תקינה",
    "כתובת מייל": "not-an-email",
  });

  assert.equal(record.email, "");
  assert.equal(record.nickname, "");
});
