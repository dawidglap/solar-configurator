"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MousePointerClick,
  Grid3x3,
  SquareDashedBottom,
  RotateCcw,
} from "lucide-react";

export function Toolbar({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] bg-white dark:bg-black rounded-xl shadow-md px-4 py-2 border flex items-center gap-2">
      <ToggleGroup type="single" value={value} onValueChange={onChange}>
        <ToggleGroupItem value="single" aria-label="Aggiungi singolo pannello">
          <MousePointerClick className="h-5 w-5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="fill" aria-label="Riempi tetto">
          <Grid3x3 className="h-5 w-5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="select" aria-label="Seleziona tetto">
          <SquareDashedBottom className="h-5 w-5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="rotate" aria-label="Ruota pannelli">
          <RotateCcw className="h-5 w-5" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
