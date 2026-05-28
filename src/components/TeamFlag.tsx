import { flagToUrl } from "@/lib/flag-url";

export default function TeamFlag({ flag, name, size = 28 }: { flag: string; name?: string; size?: number }) {
  const url = flagToUrl(flag);
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? flag}
        width={size}
        height={Math.round(size * 0.75)}
        className="object-cover rounded-sm"
        loading="lazy"
      />
    );
  }
  return <span style={{ fontSize: size * 0.85 }}>{flag}</span>;
}
