import { describe, expect, it } from "vitest";
import { locationLabel, stateLabel } from "./types";

describe("定位与状态文案", () => {
  it("文件页与印刷页分开显示，不互相冒用", () => {
    expect(locationLabel({ page_index: 0 })).toContain("文件第 1 页");
    expect(locationLabel({ page_index: 0 })).toContain("印刷页未核对");
    expect(locationLabel({ page_index: 2, printed_page: 5 })).toContain(
      "印刷页 5",
    );
    expect(locationLabel({ page_index: 2, printed_page: 5 })).not.toContain(
      "文件第 5 页",
    );
  });

  it("存档、解析、语义分析使用不同状态文案", () => {
    expect(stateLabel.saved).toBe("已存档");
    expect(stateLabel.needs_ocr).toContain("OCR");
    expect(stateLabel.local_only).toBe("本地提炼");
    expect(stateLabel.not_requested).toBe("未调用模型");
  });
});
