// PURPOSE: Полная библиотека иконок Lucide с категоризацией.
// Используется для Icon Picker Modal — пользователь выбирает иконку из полного каталога.
// Категории основаны на официальной классификации lucide-icons.

export type IconCategory = {
  key: string;
  label: string;
  icons: string[];
};

/** Популярные/избранные иконки — показываются первыми в пикере */
export const FAVORITE_ICONS: string[] = [
  'Wallet',
  'DollarSign',
  'CreditCard',
  'Banknote',
  'Coins',
  'TrendingUp',
  'TrendingDown',
  'BarChart3',
  'PieChart',
  'Activity',
  'Target',
  'Calendar',
  'Briefcase',
  'ShoppingCart',
  'Receipt',
  'Building2',
  'Users',
  'Heart',
  'Star',
  'Zap',
];

/** Полный каталог иконок по категориям */
export const ICON_CATEGORIES: IconCategory[] = [
  {
    key: 'finance',
    label: 'Финансы',
    icons: [
      'Wallet', 'DollarSign', 'CreditCard', 'Banknote', 'Coins',
      'PiggyBank', 'Landmark', 'Receipt', 'BadgeDollarSign', 'BadgePercent',
      'CircleDollarSign', 'HandCoins', 'Bitcoin', 'Euro', 'IndianRupee',
      'JapaneseYen', 'PoundSterling', 'RussianRuble', 'SwissFranc',
      'Gem', 'Vault', 'WalletCards', 'WalletMinimal', 'Percent',
    ],
  },
  {
    key: 'charts',
    label: 'Графики',
    icons: [
      'BarChart3', 'BarChart2', 'BarChart4', 'BarChartBig', 'BarChartHorizontal',
      'PieChart', 'LineChart', 'TrendingUp', 'TrendingDown', 'Activity',
      'AreaChart', 'CandlestickChart', 'GanttChart', 'ScatterChart',
      'ChartArea', 'ChartBar', 'ChartBarBig', 'ChartBarDecreasing',
      'ChartBarIncreasing', 'ChartBarStacked', 'ChartCandlestick',
      'ChartColumn', 'ChartColumnBig', 'ChartColumnDecreasing',
      'ChartColumnIncreasing', 'ChartColumnStacked', 'ChartGantt',
      'ChartLine', 'ChartNetwork', 'ChartNoAxesColumn',
      'ChartNoAxesCombined', 'ChartNoAxesGantt', 'ChartPie',
      'ChartScatter', 'ChartSpline',
    ],
  },
  {
    key: 'arrows',
    label: 'Стрелки',
    icons: [
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ArrowUpRight', 'ArrowDownRight', 'ArrowUpLeft', 'ArrowDownLeft',
      'MoveUp', 'MoveDown', 'MoveLeft', 'MoveRight',
      'ChevronUp', 'ChevronDown', 'ChevronLeft', 'ChevronRight',
      'ChevronsUp', 'ChevronsDown', 'ChevronsLeft', 'ChevronsRight',
      'ArrowBigUp', 'ArrowBigDown', 'ArrowBigLeft', 'ArrowBigRight',
      'CornerDownLeft', 'CornerDownRight', 'CornerUpLeft', 'CornerUpRight',
      'Undo2', 'Redo2', 'RotateCcw', 'RotateCw',
      'Repeat', 'RefreshCcw', 'RefreshCw',
    ],
  },
  {
    key: 'communication',
    label: 'Коммуникация',
    icons: [
      'Mail', 'MailOpen', 'Send', 'MessageSquare', 'MessageCircle',
      'Phone', 'PhoneCall', 'PhoneIncoming', 'PhoneOutgoing',
      'Video', 'VideoOff', 'Mic', 'MicOff',
      'AtSign', 'Hash', 'Bell', 'BellRing', 'BellOff',
      'Inbox', 'Archive', 'Forward', 'Reply', 'ReplyAll',
      'MessagesSquare', 'Contact', 'Contact2', 'UserPlus',
      'Voicemail', 'Radio', 'Megaphone', 'Speaker',
    ],
  },
  {
    key: 'business',
    label: 'Бизнес',
    icons: [
      'Briefcase', 'Building', 'Building2', 'Factory', 'Store',
      'ShoppingCart', 'ShoppingBag', 'Package', 'Truck',
      'Users', 'UserCircle', 'UserCheck', 'UserX',
      'Award', 'Trophy', 'Medal', 'Crown', 'BadgeCheck',
      'Handshake', 'Target', 'Crosshair', 'Presentation',
      'ClipboardList', 'ClipboardCheck', 'FileText', 'FileSpreadsheet',
      'Calculator', 'Stamp', 'Scale', 'Gavel',
      'Network', 'Share2', 'Globe', 'Rocket',
    ],
  },
  {
    key: 'time',
    label: 'Время',
    icons: [
      'Calendar', 'CalendarDays', 'CalendarCheck', 'CalendarClock',
      'CalendarPlus', 'CalendarMinus', 'CalendarX', 'CalendarRange',
      'Clock', 'Clock1', 'Clock2', 'Clock3', 'Clock4',
      'Timer', 'TimerOff', 'TimerReset', 'Hourglass',
      'AlarmClock', 'AlarmClockCheck', 'AlarmClockOff',
      'History', 'Watch', 'Stopwatch',
    ],
  },
  {
    key: 'files',
    label: 'Файлы',
    icons: [
      'File', 'FileText', 'FileCode', 'FileImage', 'FileVideo',
      'FileAudio', 'FileArchive', 'FilePlus', 'FileMinus', 'FileX',
      'FileCheck', 'FileSearch', 'FileSpreadsheet', 'FileJson',
      'Folder', 'FolderOpen', 'FolderPlus', 'FolderMinus',
      'FolderInput', 'FolderOutput', 'FolderSearch', 'FolderCheck',
      'Download', 'Upload', 'Save', 'Paperclip', 'Link',
      'HardDrive', 'Database', 'Server', 'Cloud',
    ],
  },
  {
    key: 'interface',
    label: 'Интерфейс',
    icons: [
      'Search', 'Filter', 'SlidersHorizontal', 'Settings', 'Settings2',
      'Menu', 'MoreHorizontal', 'MoreVertical', 'Grid3X3', 'LayoutGrid',
      'List', 'ListOrdered', 'Table', 'Table2', 'Columns3',
      'Maximize2', 'Minimize2', 'Expand', 'Shrink',
      'Eye', 'EyeOff', 'Lock', 'Unlock', 'Key',
      'Plus', 'Minus', 'X', 'Check', 'CheckCircle',
      'AlertCircle', 'AlertTriangle', 'Info', 'HelpCircle',
      'Home', 'Bookmark', 'Tag', 'Tags', 'Flag',
      'Layers', 'Copy', 'Trash2', 'Edit', 'Pencil',
    ],
  },
  {
    key: 'media',
    label: 'Медиа',
    icons: [
      'Image', 'Camera', 'Film', 'Music', 'Headphones',
      'Play', 'Pause', 'Square', 'SkipBack', 'SkipForward',
      'Volume', 'Volume1', 'Volume2', 'VolumeX',
      'Monitor', 'Smartphone', 'Tablet', 'Laptop', 'Tv',
      'Palette', 'Paintbrush', 'Pen', 'PenTool', 'Type',
      'Bold', 'Italic', 'Underline', 'AlignLeft', 'AlignCenter',
    ],
  },
  {
    key: 'nature',
    label: 'Природа',
    icons: [
      'Sun', 'Moon', 'Cloud', 'CloudRain', 'CloudSnow',
      'Wind', 'Thermometer', 'Droplets', 'Snowflake', 'Rainbow',
      'Flame', 'Leaf', 'TreeDeciduous', 'TreePine', 'Flower2',
      'Mountain', 'Waves', 'Fish', 'Bird', 'Bug',
      'Cat', 'Dog', 'Rabbit', 'Turtle', 'Squirrel',
    ],
  },
  {
    key: 'transport',
    label: 'Транспорт',
    icons: [
      'Car', 'Bus', 'Truck', 'Bike', 'Train',
      'Plane', 'Ship', 'Fuel', 'Gauge', 'Navigation',
      'MapPin', 'Map', 'Compass', 'Route', 'Signpost',
      'ParkingCircle', 'CircleParking', 'TrafficCone',
    ],
  },
  {
    key: 'health',
    label: 'Здоровье',
    icons: [
      'Heart', 'HeartPulse', 'Stethoscope', 'Pill', 'Syringe',
      'Thermometer', 'Baby', 'Brain', 'Bone', 'Dumbbell',
      'Apple', 'Salad', 'Coffee', 'Wine', 'Beer',
      'Cigarette', 'ShieldCheck', 'ShieldAlert', 'Activity',
    ],
  },
  {
    key: 'tech',
    label: 'Технологии',
    icons: [
      'Cpu', 'HardDrive', 'Server', 'Database', 'Cloud',
      'Wifi', 'WifiOff', 'Bluetooth', 'Nfc', 'Usb',
      'Monitor', 'Laptop', 'Smartphone', 'Tablet', 'Watch',
      'Printer', 'ScanLine', 'QrCode', 'Barcode', 'Fingerprint',
      'Bot', 'BrainCircuit', 'Sparkles', 'Wand2', 'Code',
      'Terminal', 'GitBranch', 'Github', 'Globe', 'Webhook',
    ],
  },
  {
    key: 'education',
    label: 'Образование',
    icons: [
      'BookOpen', 'Book', 'Library', 'GraduationCap', 'School',
      'PenSquare', 'Notebook', 'NotebookPen', 'Lightbulb',
      'Microscope', 'TestTube', 'Atom', 'Dna',
      'Languages', 'Ruler', 'Compass', 'Calculator',
    ],
  },
  {
    key: 'shapes',
    label: 'Фигуры',
    icons: [
      'Circle', 'Square', 'Triangle', 'Pentagon', 'Hexagon',
      'Octagon', 'Diamond', 'Star', 'Heart', 'Sparkle',
      'Asterisk', 'Hash', 'Infinity', 'Sigma',
      'CircleDot', 'CircleDashed', 'SquareDashed', 'Boxes',
    ],
  },
  {
    key: 'security',
    label: 'Безопасность',
    icons: [
      'Shield', 'ShieldCheck', 'ShieldAlert', 'ShieldOff',
      'Lock', 'LockOpen', 'Unlock', 'Key', 'KeyRound',
      'Fingerprint', 'ScanFace', 'Eye', 'EyeOff',
      'AlertTriangle', 'AlertCircle', 'Ban', 'ShieldQuestion',
      'Bug', 'Skull', 'Siren', 'FileWarning',
    ],
  },
];

/** Все уникальные имена иконок из всех категорий */
export function getAllIconNames(): string[] {
  const set = new Set<string>();
  FAVORITE_ICONS.forEach((n) => set.add(n));
  ICON_CATEGORIES.forEach((cat) => cat.icons.forEach((n) => set.add(n)));
  return Array.from(set);
}
