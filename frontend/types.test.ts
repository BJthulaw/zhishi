import { describe, it, expect } from "vitest";
import { locationLabel, stateLabel } from "./types";
describe("文献位置必须准确标识", () => {
  it("文件页与印刷页不混淆", () =>
    expect(locationLabel({ page_index: 2 })).toBe(
      "文件第 3 页 · 印刷页未核对",
    ));
  it("表格定位保留单元格范围", () =>
    expect(locationLabel({ sheet: "数据", range: "A1:B3" })).toBe(
      "数据 · A1:B3",
    ));
  it("识别内容标明派生身份", () =>
    expect(locationLabel({ page_index: 0, ocr: true })).toContain(
      "OCR 衍生文字",
    ));
  it("处理状态区别于原件存档", () =>
    expect(stateLabel.needs_ocr).not.toBe(stateLabel.saved));
});
