import { describe, expect, it } from "vite-plus/test";
import { createDisabledUpdateService } from "../src/main/updates/update-service";

describe("createDisabledUpdateService", () => {
  it("reports no update so the toast stays quiet", async () => {
    const service = createDisabledUpdateService();

    await expect(service.check()).resolves.toBeNull();
    await expect(service.download(() => undefined)).resolves.toBeUndefined();
  });

  it("refuses to install", async () => {
    await expect(createDisabledUpdateService().install()).rejects.toThrow("not available");
  });
});
