"use client";

import { Toolbar } from "../Toolbar";




type Props = {
  mode: string;
  setMode: (val: string) => void;
  setResetModules: (val: boolean) => void;
};

export default function ToolbarPanel({ mode, setMode, setResetModules }: Props) {
  return (
    <Toolbar
      value={mode}
      onChange={(val) => {
        if (!val) return;
        setMode(val);

        if (val === "deleteAll") {
          setResetModules(true);
          setTimeout(() => setResetModules(false), 100); // reset il trigger
        }
      }}
    />
  );
}
