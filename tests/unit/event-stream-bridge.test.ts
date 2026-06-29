import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../src/config/EventBus.js";
import {
  isEventStreamAuthorized,
  startEventStreamBridge,
  stopEventStreamBridge,
} from "../../src/config/EventStreamBridge.js";

describe("EventStreamBridge", () => {
  afterEach(() => {
    stopEventStreamBridge();
    EventBus.removeAllListeners("task:queued");
  });

  it("allows local event streaming when no session token is configured", () => {
    expect(isEventStreamAuthorized(null, null)).toBe(true);
    expect(isEventStreamAuthorized(null, "anything")).toBe(true);
    expect(isEventStreamAuthorized("secret", null)).toBe(false);
    expect(isEventStreamAuthorized("secret", "wrong")).toBe(false);
    expect(isEventStreamAuthorized("secret", "secret")).toBe(true);
  });

  it("removes only bridge-owned event listeners on shutdown", () => {
    const unsubscribeExternal = EventBus.on("task:queued", () => {});
    const before = EventBus.listenerCount("task:queued");

    startEventStreamBridge();
    expect(EventBus.listenerCount("task:queued")).toBeGreaterThan(before);

    stopEventStreamBridge();
    expect(EventBus.listenerCount("task:queued")).toBe(before);

    unsubscribeExternal();
    expect(EventBus.listenerCount("task:queued")).toBe(0);
  });
});
