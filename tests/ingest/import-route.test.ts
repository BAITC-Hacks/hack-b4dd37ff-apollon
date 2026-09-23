import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/import/route";
import * as repo from "../../lib/repo";

afterEach(() => vi.restoreAllMocks());
it("rejects the removed bundled demo action without starting a job or writing a dataset", async () => {
  const job = vi.spyOn(repo, "withJob");
  const save = vi.spyOn(repo, "saveDataset");
  const response = await POST(new Request("https://apollon.example/api/import", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "demo" }),
  }));
  expect(response.status).toBe(410);
  expect(job).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
