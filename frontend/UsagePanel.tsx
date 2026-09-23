import React, { useState } from "react";
import { summarizeUsage, UsageRow } from "./usage";
export default function UsagePanel({
  rows,
  refresh,
  busy,
}: {
  rows: UsageRow[];
  refresh: () => void;
  busy: boolean;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const s = summarizeUsage(rows, from, to);
  const label: Record<string, string> = {
    summary: "摘要",
    translation: "文献翻译",
    connection: "模型连接测试",
    answers: "问答",
    ocr: "图像识别",
    settled: "已完成",
    reserved: "请求中",
    usage_unknown: "请求未完成 / 用量待核对",
  };
  const tokens = (n: number | null | undefined) =>
    n == null ? "未返回" : n.toLocaleString();
  return (
    <section className="settings-card">
      <h2>LLM 调用用量</h2>
      <p className="hint">
        统计当前资料库通过本系统发起的模型请求；缓存命中不新增调用，模型连接测试计入调用次数。更换
        Key 后保留历史记录。这里不是服务商账户余额或账单。
      </p>
      <div className="button-row">
        <label className="field">
          起始日期
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          结束日期
          <input
            type="date"
            min={from}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button disabled={busy} onClick={refresh}>
          刷新用量
        </button>
        <button
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          全部日期
        </button>
      </div>
      {from && to && from > to && (
        <p role="alert">起始日期不能晚于结束日期。</p>
      )}
      <div className="usage-metrics">
        <div>
          <span>调用次数</span>
          <strong>{s.calls}</strong>
        </div>
        <div>
          <span>输入 Token</span>
          <strong>{s.input.toLocaleString()}</strong>
        </div>
        <div>
          <span>输出 Token</span>
          <strong>{s.output.toLocaleString()}</strong>
        </div>
        <div>
          <span>总 Token</span>
          <strong>{s.total.toLocaleString()}</strong>
        </div>
        <div>
          <span>预计输入 Token</span>
          <strong>{s.estimatedInput.toLocaleString()}</strong>
        </div>
        <div>
          <span>输出 Token 上限合计</span>
          <strong>{s.outputLimit.toLocaleString()}</strong>
        </div>
      </div>
      <p className="hint">
        Token 来自服务商响应；{s.unknownTokens} 条记录缺少
        Token（含旧版本记录），不作为零用量。预计输入基于文本长度与图片数量粗估，输出为请求上限，不代表实际消耗。
      </p>
      <h3>按任务汇总</h3>
      {s.tasks.map((t) => (
        <p key={t.operation}>
          {label[t.operation] || t.operation}：{t.calls} 次 ·{" "}
          {t.total.toLocaleString()} Token
          {t.unknown > 0 ? `（${t.unknown} 次未返回用量）` : ""}
        </p>
      ))}
      <div className="usage-table">
        <table>
          <thead>
            <tr>
              {[
                "时间",
                "用途 / 模型",
                "输入 / 输出 Token",
                "总 Token",
                "状态",
                "预计输入 / 输出上限",
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.records.slice(0, 100).map((r) => (
              <tr key={r.id}>
                <td>
                  {r.created ? new Date(r.created).toLocaleString() : r.day}
                </td>
                <td>
                  {label[r.operation || ""] || r.operation || "历史调用"} ·{" "}
                  {r.model || "未记录"}
                  <small>{r.endpoint || ""}</small>
                  <small>文献 / 任务：{r.source_id || "连接测试"}</small>
                </td>
                <td>
                  {tokens(r.prompt_tokens)} / {tokens(r.completion_tokens)}
                </td>
                <td>{tokens(r.total_tokens)}</td>
                <td>{label[r.state] || r.state}</td>
                <td>
                  {tokens(r.estimated_input_tokens)} /{" "}
                  {tokens(r.estimated_output_tokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!s.calls && <p className="hint">此日期范围内尚未发生模型请求。</p>}
      {s.calls > 100 && (
        <p className="hint">
          汇总包含全部 {s.calls} 条，明细显示最近 100 条；可缩小日期范围查看。
        </p>
      )}
    </section>
  );
}
