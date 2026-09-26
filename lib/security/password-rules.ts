/** Pure password rules — safe to import from client components. */
export const PASSWORD_MIN_LENGTH = 10;

export function passwordProblems(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9\W_]/.test(password)) {
    return "Use a mix of letters and numbers or symbols.";
  }
  return null;
}
