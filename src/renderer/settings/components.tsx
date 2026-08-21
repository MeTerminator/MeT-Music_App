import { useEffect, useState } from "react";
import type React from "react";

/** 开关(对应旧 .switch/.slider 结构) */
export function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider"></span>
    </label>
  );
}

/**
 * 数字输入框(对应旧 v-model.number + @change 语义:
 * 输入过程中不提交,失焦或回车时才提交;非法输入回退为当前值)。
 */
export function NumberInput({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (): void => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      onCommit(parsed);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <input
      type="number"
      className="num-input"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

export interface FeaturedFont {
  label: string;
  value: string;
}

/** 字体下拉框(系统默认 + 内置推荐 + queryLocalFonts 结果) */
export function FontSelect({
  value,
  featuredFonts,
  systemFonts,
  onChange,
}: {
  value: string;
  featuredFonts: readonly FeaturedFont[];
  systemFonts: readonly string[];
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <select className="select-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">系统默认</option>
      <optgroup label="内置与系统推荐">
        {featuredFonts.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
      </optgroup>
      {systemFonts.length > 0 && (
        <optgroup label="系统已安装字体">
          {systemFonts.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
