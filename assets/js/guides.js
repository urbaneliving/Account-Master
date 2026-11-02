// Guides shown in Settings → Guide. Every text is { en, hi }.
// Formatting inside texts: **bold**, `code / path`, [[Key]] for a keyboard key.
// To add a guide, add an object to the list below.
window.UL_GUIDES = [
  {
    id: 'windows-11',
    icon: '💻',
    category: { en: 'IT', hi: 'IT' },
    updated: 'Nov 2026',
    author: { name: 'Saban Jha', role: 'IT Manager', phones: ['9973720095', '9105052454'], email: 'it@urbaneliving.in' },
    title: { en: 'How to reinstall Windows 11', hi: 'Windows 11 दोबारा इंस्टॉल करने का तरीका' },
    summary: {
      en: 'For office PCs with a Gigabyte motherboard. Follow the steps in order, top to bottom. If you get stuck, take a photo of the screen and send it to the IT Manager.',
      hi: 'Gigabyte मदरबोर्ड वाले ऑफ़िस PC के लिए। स्टेप ऊपर से नीचे क्रम में कीजिए। कहीं अटक जाएँ तो स्क्रीन की फ़ोटो लेकर IT Manager को भेजिए।',
    },
    needs: [
      { icon: '🔌', en: 'USB pen drive 8 GB+', hi: 'पेन ड्राइव 8 GB+' },
      { icon: '🖥️', en: 'A second PC with internet', hi: 'इंटरनेट वाला दूसरा PC' },
      { icon: '💾', en: 'Hard disk for backup', hi: 'बैकअप के लिए हार्ड डिस्क' },
      { icon: '⏱️', en: '1–2 hours', hi: '1–2 घंटे' },
    ],
    steps: [
      {
        title: { en: 'Back up your data', hi: 'बैकअप लीजिए' },
        tag: { en: 'Both PCs', hi: 'दोनों PC' },
        items: [
          { en: 'Copy the existing data from the pen drive to a computer. The pen drive will be completely erased.', hi: 'पेन ड्राइव का पुराना डेटा कंप्यूटर में कॉपी कीजिए। पेन ड्राइव पूरी मिट जाएगी।' },
          { en: 'On the PC getting Windows, copy **Desktop, Documents, Downloads** and **Pictures**.', hi: 'जिस PC में Windows डालनी है, उसका **Desktop, Documents, Downloads** और **Pictures** कॉपी कीजिए।' },
          { en: 'On a designer PC, also copy the fonts: `C:\\Windows\\Fonts`', hi: 'डिज़ाइनर PC हो तो फ़ॉन्ट भी कॉपी कीजिए: `C:\\Windows\\Fonts`' },
          { en: 'Note down software licence keys (CorelDraw, Adobe, Office, Tally).', hi: 'सॉफ़्टवेयर की लाइसेंस की लिख लीजिए (CorelDraw, Adobe, Office, Tally)।' },
        ],
        note: { type: 'warn', en: 'Check the backup before you continue. The C: drive will be completely erased.', hi: 'बैकअप चेक किए बिना आगे मत बढ़िए। C: ड्राइव पूरी मिट जाएगी।' },
      },
      {
        title: { en: 'Make the bootable pen drive', hi: 'बूटेबल पेन ड्राइव बनाइए' },
        tag: { en: 'Working PC · 30–60 min', hi: 'चालू PC · 30–60 मिनट' },
        items: [
          { en: 'Open in Chrome: microsoft.com/software-download/windows11', hi: 'Chrome में खोलिए: microsoft.com/software-download/windows11' },
          { en: '**Create Windows 11 Installation Media** → **Download Now** → run **MediaCreationTool** → **Accept**.', hi: '**Create Windows 11 Installation Media** → **Download Now** → **MediaCreationTool** चलाइए → **Accept**।' },
          { en: 'Language **English (United States)**, Edition **Windows 11** → **Next**.', hi: 'Language **English (United States)**, Edition **Windows 11** → **Next**।' },
          { en: '**USB flash drive** → pick your pen drive (check its size) → **Next**.', hi: '**USB flash drive** → अपनी पेन ड्राइव चुनिए (साइज़ से पहचानिए) → **Next**।' },
          { en: '**Your USB flash drive is ready** → **Finish**.', hi: '**Your USB flash drive is ready** → **Finish**।' },
          { en: 'File Explorer ([[Win]] + [[E]]) → right-click **ESD-USB** → **Eject** → remove the pen drive.', hi: 'File Explorer ([[Win]] + [[E]]) → **ESD-USB** पर राइट क्लिक → **Eject** → पेन ड्राइव निकालिए।' },
        ],
      },
      {
        title: { en: 'Start the PC from the pen drive', hi: 'पेन ड्राइव से PC स्टार्ट कीजिए' },
        tag: { en: 'Target PC', hi: 'टारगेट PC' },
        items: [
          { en: 'Shut down the PC. Plug the pen drive into a USB port on the **back** of the CPU.', hi: 'PC Shut down कीजिए। पेन ड्राइव CPU के **पीछे** वाले USB पोर्ट में लगाइए।' },
          { en: 'Press the power button, then **tap the boot key repeatedly**.', hi: 'पावर बटन दबाते ही **बूट की बार-बार दबाइए**।' },
          { en: 'In the list, pick **UEFI: USB** / **UEFI: [pen drive name]** → [[Enter]].', hi: 'लिस्ट में **UEFI: USB** / **UEFI: [पेन ड्राइव का नाम]** चुनिए → [[Enter]]।' },
          { en: 'If Windows opens instead, the key was pressed too late. Shut down and try again.', hi: 'अगर Windows खुल जाए तो की देर से दबाई गई। फिर से Shut down करके कोशिश कीजिए।' },
        ],
        keys: {
          title: { en: 'Boot key by motherboard / brand', hi: 'मदरबोर्ड / ब्रांड के हिसाब से बूट की' },
          rows: [['F12', 'Gigabyte', true], ['F11', 'MSI, ASRock'], ['F8', 'Asus'], ['F12', 'Dell, Lenovo'], ['F9 / Esc', 'HP']],
        },
      },
      {
        title: { en: 'Install Windows', hi: 'Windows इंस्टॉल कीजिए' },
        tag: { en: 'Target PC · 15–30 min', hi: 'टारगेट PC · 15–30 मिनट' },
        items: [
          { en: 'Language screen → **Next** → **Install Windows 11** → tick "everything will be deleted" → **Next**.', hi: 'Language स्क्रीन → **Next** → **Install Windows 11** → "everything will be deleted" पर टिक → **Next**।' },
          { en: '**I don\'t have a product key** → **Windows 11 Pro** → **Accept**.', hi: '**I don\'t have a product key** → **Windows 11 Pro** → **Accept**।' },
          { en: 'On **Select location to install Windows 11**, delete partitions by checking their size and type (see the table below).', hi: '**Select location to install Windows 11** वाली स्क्रीन पर पार्टिशन साइज़ और टाइप देखकर डिलीट कीजिए (नीचे टेबल देखिए)।' },
          { en: 'Select **Disk 0 Unallocated Space** → **Next**.', hi: '**Disk 0 Unallocated Space** चुनिए → **Next**।' },
          { en: 'When the PC restarts and the screen goes black, **remove the pen drive**.', hi: 'PC रीस्टार्ट हो और स्क्रीन काली हो, तब **पेन ड्राइव निकालिए**।' },
        ],
        table: {
          head: { en: ['Partition', 'Size (example)', 'Type', 'Action'], hi: ['पार्टिशन', 'साइज़ (उदाहरण)', 'टाइप', 'क्या करें'] },
          rows: [
            [{ en: 'System', hi: 'System' }, '100 MB', 'System', 'delete'],
            [{ en: 'MSR', hi: 'MSR' }, '16 MB', 'MSR (Reserved)', 'delete'],
            [{ en: 'Old Windows (C:)', hi: 'पुरानी Windows (C:)' }, '~468 GB', 'Primary', 'delete'],
            [{ en: 'Recovery', hi: 'Recovery' }, '~900 MB', 'Recovery', 'delete'],
            [{ en: 'Data drive (D:)', hi: 'डेटा ड्राइव (D:)' }, '~485 GB', 'Primary', 'keep'],
            [{ en: 'ESD-USB (pen drive)', hi: 'ESD-USB (पेन ड्राइव)' }, '~29 GB', 'Disk 1', 'keep'],
          ],
          actions: { delete: { en: 'Delete', hi: 'Delete' }, keep: { en: "Don't touch", hi: 'मत छेड़िए' } },
        },
        note: { type: 'danger', en: 'If unsure, send a photo of this screen to the IT Manager before deleting anything. If the D: drive is deleted by mistake, its data cannot be recovered.', hi: 'शक हो तो कुछ भी डिलीट करने से पहले इस स्क्रीन की फ़ोटो IT Manager को भेजिए। D: ड्राइव गलती से डिलीट हुई तो उसका डेटा वापस नहीं आएगा।' },
      },
      {
        title: { en: 'First-time setup', hi: 'पहला सेटअप' },
        tag: { en: 'Target PC', hi: 'टारगेट PC' },
        items: [
          { en: 'Country **India** → Keyboard **US** → second keyboard **Skip**.', hi: 'Country **India** → Keyboard **US** → second keyboard **Skip**।' },
          { en: 'Connect WiFi or LAN → name the PC (for example `DESIGNER-PC`).', hi: 'WiFi या LAN जोड़िए → PC का नाम रखिए (जैसे `DESIGNER-PC`)।' },
          { en: 'Sign in with a Microsoft account → create a PIN.', hi: 'Microsoft account से लॉगिन कीजिए → PIN बनाइए।' },
          { en: 'Choose **Set up as a new PC**. Do not restore.', hi: '**Set up as a new PC** चुनिए। Restore मत कीजिए।' },
          { en: 'Privacy, OneDrive, Phone Link, offers → **Skip / No thanks**.', hi: 'Privacy, OneDrive, Phone Link, ऑफ़र → **Skip / No thanks**।' },
          { en: '**Your PC is ready** → **Go to desktop**.', hi: '**Your PC is ready** → **Go to desktop**।' },
        ],
        note: { type: 'info', en: 'If a Gigabyte "APP Center – Failed to download" popup appears, press **Cancel**. It does no harm.', hi: 'Gigabyte का "APP Center – Failed to download" पॉपअप आए तो **Cancel** दबाइए। इससे कोई नुकसान नहीं होता।' },
      },
      {
        title: { en: 'After installation', hi: 'इंस्टॉल के बाद' },
        tag: { en: 'Target PC', hi: 'टारगेट PC' },
        items: [
          { en: 'Settings → **Windows Update** → **Check for updates**. Repeat until it says "You\'re up to date". Also install driver updates from **Optional updates**.', hi: 'Settings → **Windows Update** → **Check for updates**। "You\'re up to date" आने तक दोहराइए। **Optional updates** में ड्राइवर अपडेट भी डालिए।' },
          { en: 'Install the **NVIDIA App** (nvidia.com/en-in/software/nvidia-app) → Drivers → **Studio Driver** → Express install → Restart.', hi: '**NVIDIA App** इंस्टॉल कीजिए (nvidia.com/en-in/software/nvidia-app) → Drivers → **Studio Driver** → Express install → Restart।' },
          { en: 'NVIDIA App → Graphics → Global Settings → Power management mode → **Prefer maximum performance**.', hi: 'NVIDIA App → Graphics → Global Settings → Power management mode → **Prefer maximum performance**।' },
          { en: 'Settings → System → Power → Screen, sleep & hibernate timeouts → set all to **Never**.', hi: 'Settings → System → Power → Screen, sleep & hibernate timeouts → सब **Never**।' },
          { en: 'Copy files and fonts back from the backup (fonts: select → right-click → **Install**). Reinstall software.', hi: 'बैकअप से फ़ाइलें और फ़ॉन्ट वापस डालिए (फ़ॉन्ट: सेलेक्ट → राइट क्लिक → **Install**)। सॉफ़्टवेयर इंस्टॉल कीजिए।' },
        ],
      },
    ],
  },
];
