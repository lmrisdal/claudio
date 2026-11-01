import type { ImgHTMLAttributes } from "react";
import { useServerStatus } from "../hooks/use-server-status";

export default function ServerImage(properties: ImgHTMLAttributes<HTMLImageElement>) {
  const { isConnected } = useServerStatus();

  return (
    <img
      key={String(isConnected)}
      {...properties}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
