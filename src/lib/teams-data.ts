export const TEAMS = [
  // Group A — hosts: Mexico
  { name: "Mexico",                 flag: "🇲🇽", group: "A" },
  { name: "South Africa",           flag: "🇿🇦", group: "A" },
  { name: "South Korea",            flag: "🇰🇷", group: "A" },
  { name: "Czechia",                flag: "🇨🇿", group: "A" },
  // Group B — hosts: Canada
  { name: "Canada",                 flag: "🇨🇦", group: "B" },
  { name: "Switzerland",            flag: "🇨🇭", group: "B" },
  { name: "Qatar",                  flag: "🇶🇦", group: "B" },
  { name: "Bosnia and Herzegovina", flag: "🇧🇦", group: "B" },
  // Group C
  { name: "Brazil",                 flag: "🇧🇷", group: "C" },
  { name: "Morocco",                flag: "🇲🇦", group: "C" },
  { name: "Haiti",                  flag: "🇭🇹", group: "C" },
  { name: "Scotland",               flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", group: "C" },
  // Group D — hosts: United States
  { name: "United States",          flag: "🇺🇸", group: "D" },
  { name: "Paraguay",               flag: "🇵🇾", group: "D" },
  { name: "Australia",              flag: "🇦🇺", group: "D" },
  { name: "Türkiye",                flag: "🇹🇷", group: "D" },
  // Group E
  { name: "Germany",                flag: "🇩🇪", group: "E" },
  { name: "Curaçao",                flag: "🇨🇼", group: "E" },
  { name: "Côte d'Ivoire",          flag: "🇨🇮", group: "E" },
  { name: "Ecuador",                flag: "🇪🇨", group: "E" },
  // Group F
  { name: "Netherlands",            flag: "🇳🇱", group: "F" },
  { name: "Japan",                  flag: "🇯🇵", group: "F" },
  { name: "Tunisia",                flag: "🇹🇳", group: "F" },
  { name: "Sweden",                 flag: "🇸🇪", group: "F" },
  // Group G
  { name: "Belgium",                flag: "🇧🇪", group: "G" },
  { name: "Egypt",                  flag: "🇪🇬", group: "G" },
  { name: "Iran",                   flag: "🇮🇷", group: "G" },
  { name: "New Zealand",            flag: "🇳🇿", group: "G" },
  // Group H
  { name: "Spain",                  flag: "🇪🇸", group: "H" },
  { name: "Cabo Verde",             flag: "🇨🇻", group: "H" },
  { name: "Saudi Arabia",           flag: "🇸🇦", group: "H" },
  { name: "Uruguay",                flag: "🇺🇾", group: "H" },
  // Group I
  { name: "France",                 flag: "🇫🇷", group: "I" },
  { name: "Senegal",                flag: "🇸🇳", group: "I" },
  { name: "Iraq",                   flag: "🇮🇶", group: "I" },
  { name: "Norway",                 flag: "🇳🇴", group: "I" },
  // Group J
  { name: "Argentina",              flag: "🇦🇷", group: "J" },
  { name: "Algeria",                flag: "🇩🇿", group: "J" },
  { name: "Austria",                flag: "🇦🇹", group: "J" },
  { name: "Jordan",                 flag: "🇯🇴", group: "J" },
  // Group K
  { name: "Portugal",               flag: "🇵🇹", group: "K" },
  { name: "Uzbekistan",             flag: "🇺🇿", group: "K" },
  { name: "Colombia",               flag: "🇨🇴", group: "K" },
  { name: "Congo DR",               flag: "🇨🇩", group: "K" },
  // Group L
  { name: "England",                flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", group: "L" },
  { name: "Croatia",                flag: "🇭🇷", group: "L" },
  { name: "Ghana",                  flag: "🇬🇭", group: "L" },
  { name: "Panama",                 flag: "🇵🇦", group: "L" },
] as const;

export type TeamEntry = (typeof TEAMS)[number];
