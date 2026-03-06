// Standardized logging utility for consistent output formatting

export const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${msg}`);
    }
  },
  success: (msg) => console.log(`[OK] ${msg}`)
};

export default logger;
