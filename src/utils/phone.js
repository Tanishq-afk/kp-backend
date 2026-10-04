// Normalizes an Indian mobile number to its 10 digits: strips spaces, dashes and
// a leading +91 / 91. Returns the input unchanged when it is not a phone-like value,
// so the route validator can reject it.
export const normalizePhone = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};
