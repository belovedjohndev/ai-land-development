import { describe, expect, it } from "vitest";
import {
  Argon2idPasswordHasher,
  argon2idOptions,
} from "./argon2id-password-hasher.js";

describe("Argon2idPasswordHasher", () => {
  it("hashes with explicit Argon2id parameters and verifies safely", async () => {
    const hasher = new Argon2idPasswordHasher();
    const encoded = await hasher.hash("correct-horse-battery-staple");

    expect(encoded).toContain("$argon2id$v=19$");
    expect(encoded).toContain(
      `m=${argon2idOptions.memoryCost},p=${argon2idOptions.parallelism},t=${argon2idOptions.timeCost}`,
    );
    await expect(
      hasher.verify(encoded, "correct-horse-battery-staple"),
    ).resolves.toBe(true);
    await expect(hasher.verify(encoded, "incorrect-password")).resolves.toBe(
      false,
    );
    await expect(
      hasher.verify("not-an-argon2-hash", "incorrect-password"),
    ).resolves.toBe(false);
  });
});
