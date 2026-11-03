// Organisation settings. The grade and department lists are placeholders from
// the design hand-off — replace them with JPPS's own lists.
module.exports = {
  orgName: 'Jabatan Perkhidmatan Pembetungan Sarawak',
  // Displayed on two lines in the banner.
  orgNameLines: ['Jabatan Perkhidmatan', 'Pembetungan Sarawak'],
  timeZone: process.env.TZ_NAME || 'Asia/Kuching',
  grades: ['J41', 'J44', 'J48', 'JA29', 'N19', 'N29', 'H11'],
  departments: ['Operations', 'Engineering', 'Planning', 'Administration', 'Finance', 'Regulatory & Enforcement'],
  // The program created on first start.
  seedProgram: {
    name: 'High Performance Team (HPT) SSDS 2026',
    dates: '20–22 November 2026',
    venue: 'Damai Beach Resort, Kuching',
    pin: '2611',
  },
};
