import { useState } from "react";
export const presets = [
  {
    id: "bailian",
    name: "阿里云百炼 / DashScope（北京）",
    base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    currency: "CNY",
  },
  {
    id: "bailian-intl",
    name: "阿里云百炼（新加坡）",
    base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    currency: "CNY",
  },
  {
    id: "deepseek",
    name: "DeepSeek 官方",
    base: "https://api.deepseek.com",
    model: "deepseek-flash",
    currency: "USD",
  },
];
export default function ProviderGuide({
  provider,
  setProvider,
}: {
  provider: Record<string, any>;
  setProvider: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}) {
  const [selected, setSelected] = useState("");
  return (
    <div className="provider-guide">
      <label className="field">
        选择服务平台
        <select
          aria-label="服务平台"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            const p = presets.find((p) => p.id === e.target.value);
            if (p)
              setProvider((v) => ({
                ...v,
                base_url: p.base,
                model: p.model,
              }));
          }}
        >
          <option value="">自定义 / 保留现有配置</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        选择平台后自动填写兼容接口地址和示例模型。Key
        的地域必须一致；切换平台请填写新 Key。模型名称请填准确 ID（如
        qwen-plus），不要只填“Qwen”。
      </p>
      <p className="hint">
        百炼支持本系统使用的 OpenAI 兼容接口，地址结尾应为
        /compatible-mode/v1，不是原生 /api/v1。业务空间专属地址：
        https://&#123;WorkspaceId&#125;.cn-beijing.maas.aliyuncs.com/compatible-mode/v1。
      </p>
    </div>
  );
}
