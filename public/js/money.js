// In-game money, shown the same short way everywhere (website and game): $12.50, $1.5K, $12.35K, $3M, $1B, $2.5T.
const UNITS = [[1e3, "K"], [1e6, "M"], [1e9, "B"], [1e12, "T"], [1e15, "Q"]];

export function moneyDollars(value) {
  if (value == null || Number.isNaN(Number(value))) return "–";
  const n = Number(value);
  const sign = n < 0 ? "-" : "";
  const d = Math.abs(n);
  if (d < 999.995) return `${sign}$${Number.isInteger(d) ? d : d.toFixed(2)}`;
  for (let i = UNITS.length - 1; i >= 0; i--) {
    const [size, letter] = UNITS[i];
    if (d >= size * 0.999995) {
      let text = (d / size).toFixed(2).replace(/\.?0+$/, "");
      let unit = letter;
      if (text === "1000" && UNITS[i + 1]) { text = "1"; unit = UNITS[i + 1][1]; } // 999.999K -> 1M
      return `${sign}$${text}${unit}`;
    }
  }
  return `${sign}$${Math.round(d)}`;
}

// Money stored as cents (how the game and database keep it).
export const money = (cents) => (cents == null ? "–" : moneyDollars(Number(cents) / 100));

// The exact amount, for a tooltip.
export const moneyExact = (cents) => "$" + (Number(cents) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
