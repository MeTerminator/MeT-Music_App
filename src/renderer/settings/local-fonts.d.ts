/**
 * Local Font Access API 类型声明(设置窗已在 main 侧开启 local-fonts 权限)。
 * TS DOM lib 尚未内置该 API,此处补充最小声明。
 */
interface LocalFontData {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
}

interface Window {
  queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<LocalFontData[]>;
}
