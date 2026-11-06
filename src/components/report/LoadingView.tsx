// What the page shows while a report loads: the shape of the answer, in plain bars, after a short wait so a
// fast load never flashes. Nothing moves. A screen reader is told the call is loading.
import { LOADING_LABEL } from "@/report/labels";

const bar = "rounded bg-report-line";

export function LoadingView() {
  return (
    <div aria-busy="true">
      <div role="status" className="sr-only">
        {LOADING_LABEL}
      </div>
      <div data-delayed aria-hidden className="report-delayed">
        <div className="flex items-center gap-3">
          <div className={`${bar} h-6 w-20 rounded-full`} />
          <div className={`${bar} h-4 w-44`} />
        </div>
        <div className={`${bar} mt-5 h-8 w-full max-w-[34ch]`} />
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
          {[24, 20, 36, 28, 32].map((w, i) => (
            <div key={i} className="space-y-2">
              <div className={`${bar} h-3 w-14`} />
              <div className={`${bar} h-4`} style={{ width: `${w * 4}px` }} />
            </div>
          ))}
        </div>
        <div className="mt-14 space-y-4 border-t border-report-line pt-6">
          <div className={`${bar} h-6 w-56`} />
          <div className={`${bar} h-5 w-full max-w-[62ch]`} />
          <div className={`${bar} h-24 w-full`} />
        </div>
      </div>
    </div>
  );
}
