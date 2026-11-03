import iconLight from "./klygenix-icon-light.svg"
import nameLockupLight from "./klygenix-lockup-name-light.svg"

export function KlygenixIcon({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <img
      src={iconLight}
      alt="Klygenix"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    />
  )
}

export function KlygenixWordmark({ height = 30, className }: { height?: number; className?: string }) {
  return (
    <img
      src={nameLockupLight}
      alt="Klygenix"
      className={className}
      style={{ height, width: "auto" }}
    />
  )
}
