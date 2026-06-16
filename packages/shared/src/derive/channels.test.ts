import { describe, it, expect } from "vitest";
import { deriveChannels, youtubeCategoryId, metaCtaType } from "./channels.js";

describe("deriveChannels", () => {
  it("routes YT-Long to YouTube only", () => {
    expect(deriveChannels("YT-Long", "16:9", "MOFU")).toEqual(["YouTube"]);
  });
  it("routes a TOFU Reel to paid and organic", () => {
    expect(deriveChannels("Reel", "9:16", "TOFU")).toEqual(["Meta-paid", "Meta-organic"]);
  });
  it("routes a MOFU Feed to paid and organic", () => {
    expect(deriveChannels("Feed", "4:5", "MOFU")).toEqual(["Meta-paid", "Meta-organic"]);
  });
  it("routes a 1:1 Carousel to organic only", () => {
    expect(deriveChannels("Carousel", "1:1", "TOFU")).toEqual(["Meta-organic"]);
  });
  it("routes a 4:5 Carousel to paid and organic", () => {
    expect(deriveChannels("Carousel", "4:5", "TOFU")).toEqual(["Meta-paid", "Meta-organic"]);
  });
});

describe("youtubeCategoryId", () => {
  it("maps a known Notion category to its YouTube id", () => {
    expect(youtubeCategoryId("Howto & Style")).toBe("26");
  });
  it("defaults unknown categories to Education (27)", () => {
    expect(youtubeCategoryId("Cooking")).toBe("27");
  });
});

describe("metaCtaType", () => {
  it("uses LEARN_MORE for TOFU", () => {
    expect(metaCtaType("TOFU", "Find out more")).toBe("LEARN_MORE");
  });
  it("uses SIGN_UP for MOFU", () => {
    expect(metaCtaType("MOFU", "Register today")).toBe("SIGN_UP");
  });
  it("uses WHATSAPP_MESSAGE for a BOFU consult CTA", () => {
    expect(metaCtaType("BOFU", "Chat with our consultant")).toBe("WHATSAPP_MESSAGE");
  });
  it("uses SIGN_UP for a BOFU CTA with no consult hint", () => {
    expect(metaCtaType("BOFU", "Open your account")).toBe("SIGN_UP");
  });
});
