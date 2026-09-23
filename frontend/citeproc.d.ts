declare module "citeproc" {
  const CSL: { Engine: new (sys: any, style: string, lang?: string) => any };
  export default CSL;
}
