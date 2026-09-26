/** IANA time zones for pickers. `Intl.supportedValuesOf` omits "UTC" (our default), so it's added first. */
export function timeZoneOptions(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}
