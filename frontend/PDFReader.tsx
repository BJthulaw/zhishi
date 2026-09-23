import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = worker;
function PDFPage({ doc, number }: { doc: PDFDocumentProxy; number: number }) {
  const box = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false),
    [ratio, setRatio] = useState(0.707),
    [error, setError] = useState("");
  useEffect(() => {
    const el = box.current!;
    const root = el.closest(".reader-scroll");
    const observer = new IntersectionObserver(
      (entries) => setNear(entries[0].isIntersecting),
      { root, rootMargin: "800px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [number]);
  useEffect(() => {
    let cancelled = false;
    doc
      .getPage(number)
      .then((p) => {
        if (!cancelled) {
          const v = p.getViewport({ scale: 1 });
          setRatio(v.width / v.height);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, number]);
  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    doc
      .getPage(number)
      .then((p) => {
        if (cancelled || !canvas.current) return;
        const viewport = p.getViewport({ scale: 1.4 });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        render = p.render({
          canvas: canvas.current,
          canvasContext: canvas.current.getContext("2d")!,
          viewport,
        });
        return render.promise;
      })
      .catch((e) => {
        if (!cancelled && e.name !== "RenderingCancelledException")
          setError(e.message);
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, number, near]);
  return (
    <div
      className="pdf-page"
      ref={box}
      data-pdf-page={number}
      style={{ aspectRatio: ratio }}
      aria-label={`PDF 文件第 ${number} 页`}
    >
      <span className="pdf-page-label">文件第 {number} 页</span>
      {error ? (
        <p className="error">{error}</p>
      ) : near ? (
        <canvas ref={canvas} />
      ) : (
        <span className="hint">滚动到此处加载页面</span>
      )}
    </div>
  );
}
export default function PDFReader({
  sourceId,
  page,
  onPage,
}: {
  sourceId: string;
  page: number;
  onPage: (n: number) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(""),
    [visible, setVisible] = useState(page);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setDoc(null);
    setError("");
    const task = getDocument({
      url: `zhishi-asset://source/${sourceId}/original`,
      isEvalSupported: false,
    });
    task.promise
      .then((d) => {
        if (active) setDoc(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [sourceId]);
  useEffect(() => {
    if (doc)
      host.current
        ?.querySelector(
          `[data-pdf-page="${Math.min(Math.max(page, 1), doc.numPages)}"]`,
        )
        ?.scrollIntoView({ block: "start" });
  }, [page, doc]);
  useEffect(() => {
    const root = host.current?.closest(".reader-scroll");
    if (!doc || !root) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = root.getBoundingClientRect();
        let best = 0,
          current = 1;
        host.current
          ?.querySelectorAll<HTMLElement>("[data-pdf-page]")
          .forEach((el) => {
            const rect = el.getBoundingClientRect();
            const overlap = Math.max(
              0,
              Math.min(rect.bottom, bounds.bottom) -
                Math.max(rect.top, bounds.top + 60),
            );
            if (overlap > best) {
              best = overlap;
              current = Number(el.dataset.pdfPage);
            }
          });
        if (best) setVisible(current);
      });
    };
    root.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      root.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
    };
  }, [doc]);
  function jump(n: number) {
    n = Math.max(1, Math.min(doc?.numPages || 1, n || 1));
    setVisible(n);
    onPage(n);
    host.current
      ?.querySelector(`[data-pdf-page="${n}"]`)
      ?.scrollIntoView({ block: "start" });
  }
  return (
    <div className="pdf-view" ref={host}>
      <div className="pdf-tools">
        <button disabled={visible <= 1} onClick={() => jump(visible - 1)}>
          上一页
        </button>
        <span>
          文件页{" "}
          <input
            aria-label="PDF页码"
            type="number"
            min="1"
            max={doc?.numPages || 1}
            value={visible}
            onChange={(e) => jump(Number(e.target.value))}
          />{" "}
          / {doc?.numPages || "…"}
        </span>
        <button
          disabled={!doc || visible >= doc.numPages}
          onClick={() => jump(visible + 1)}
        >
          下一页
        </button>
      </div>
      <p className="hint">
        支持鼠标滚轮连续阅读全部页面，也可输入页码跳转。文件页序不等于印刷页码。
      </p>
      {error ? (
        <p className="error">{error}</p>
      ) : (
        doc &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PDFPage key={`${sourceId}-${i}`} doc={doc} number={i + 1} />
        ))
      )}
    </div>
  );
}
