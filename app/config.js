// Organisation settings.
module.exports = {
  orgName: 'Jabatan Perkhidmatan Pembetungan Sarawak',
  // Displayed on two lines in the banner.
  orgNameLines: ['Jabatan Perkhidmatan', 'Pembetungan Sarawak'],
  timeZone: process.env.TZ_NAME || 'Asia/Kuching',
  // LOKASI codes in the PERJAWATAN staff list. Codes not listed here are shown as-is.
  locationNames: {
    HQ: 'Ibu Pejabat (HQ)',
    K: 'Kuching',
    M: 'Miri',
    B: 'Bintulu',
    JKR: 'JKR Sarawak',
  },
  // Choices offered to people who are not on the staff list. "Other" lets them type an agency.
  guestLocations: ['Ibu Pejabat (HQ)', 'Kuching', 'Miri', 'Bintulu'],
  // Grade suggestions for people not on the staff list (merged with the grades in the uploaded list).
  guestGrades: ['VU7', 'J14', 'J13', 'J12', 'J10', 'J9', 'N13', 'N12', 'N10', 'N9', 'W9', 'JA7', 'JA6', 'JA5', 'N7', 'N6', 'N5', 'W7', 'W6', 'W5', 'N3', 'N2', 'N1', 'W3', 'W2', 'W1', 'H3', 'H2', 'H1', 'KP3', 'KP2', 'KP1'],
  // The program created on first start.
  seedProgram: {
    name: 'High Performance Team (HPT) SSDS 2026',
    dates: '20–22 November 2026',
    venue: 'Damai Beach Resort, Kuching',
    pin: '2611',
  },
};
