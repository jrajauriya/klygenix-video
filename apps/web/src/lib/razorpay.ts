declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (r: unknown) => void) => void }
  }
}

let razorpayScript: Promise<void> | null = null

export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  if (razorpayScript) return razorpayScript
  razorpayScript = new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "https://checkout.razorpay.com/v1/checkout.js"
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      razorpayScript = null
      reject(new Error("Razorpay could not load"))
    }
    document.head.appendChild(s)
  })
  return razorpayScript
}
