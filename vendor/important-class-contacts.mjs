// Numbers match a whole grade. Strings match an exact class.
const assignments = {
  mentor: [
    [[1, 2], 'Александр Александрович', 'isaisaisaisakov'],
    [[3], 'Михаил Юрьевич', 'doubleHeart_tyler'],
    [[4], 'Ксения Николаевна', 'KsenyaStu'],
    [[1, 2, 3, 4], 'Андрей Александрович', 'earthstranger'],
    [[5], 'Вероника Андреевна', 'merkveronika'],
    [[6], 'Алиса Юрьевна', 'NovikovaAlisa'],
    [[7, 8], 'Семен Семенович', 'semachos'],
    [[9], 'Марина Витальевна', 'marina_yunikova'],
    [['10-1'], 'Элина Игоревна', 'elka0705'],
  ],
  tutor: [
    [[1, 2, 3, 4], 'Кристина Витальевна', 'augustell'],
    [[5], 'Анастасия Николаевна', 'Chalenko_N'],
    [[6, 7], 'Мария Владимировна', 'mariatsay'],
    [['8-1'], 'Дарья Леонидовна', 'd120833'],
  ],
};

const classOrder = new Intl.Collator('ru', { numeric: true });
const normalizeContactName = name => name.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/\s+/g, ' ');
export const classContactNames = Object.values(assignments).flat().map(([, name]) => normalizeContactName(name));

export function contactsForClasses(classNames, staffNames = []) {
  const classes = [...new Set(classNames.filter(name => typeof name === 'string').map(name => name.trim()).filter(Boolean))].sort(classOrder.compare);
  const fullNames = new Map();
  for (const rawName of staffNames) {
    if (typeof rawName !== 'string') continue;
    const words = normalizeContactName(rawName).split(' ');
    if (words.length < 3) continue;
    const shortName = words.slice(-2).join(' ');
    if (!fullNames.has(shortName)) fullNames.set(shortName, new Set());
    fullNames.get(shortName).add(rawName.trim());
  }
  const contacts = {};
  for (const [role, people] of Object.entries(assignments)) {
    const matches = [];
    for (const [selectors, shortName, handle] of people) {
      const covered = classes.filter(name => {
        const normalized = name.replace(/\s*[-–—]\s*/g, '-');
        const grade = /^(\d{1,2})(?:-\d+)?$/.exec(normalized)?.[1];
        return selectors.includes(normalized) || (grade && selectors.includes(Number(grade)));
      });
      if (!covered.length) continue;
      const names = fullNames.get(normalizeContactName(shortName));
      const name = names?.size === 1 ? [...names][0] : shortName;
      matches.push({ name, href: `https://t.me/${handle}`, classNames: covered });
    }
    if (matches.length) contacts[role] = matches;
  }
  return contacts;
}
