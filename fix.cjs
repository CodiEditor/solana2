const fs=require('fs');let s=fs.readFileSync('src/main.ts','utf8');
s=s.replace('train.exe     training lokal / jaringan (LoRA)','train.exe     local / network training (LoRA)');
s=s.replace('models        CHAT — model besar + lapisan Anda','models        CHAT — big model + your layer');
s=s.replace('sysinfo       spek mesin & benchmark','sysinfo       machine specs & benchmark');
s=s.replace('network       node GPU jaringan','network       GPU network nodes');
s=s.replace('leaderboard   top miner','leaderboard   top miners');
s=s.replace('wallet        address, kredit, $SOLANA (wajib untuk jaringan)','wallet        address, credits, $SOLANA (required for network)');
s=s.replace('readme.txt    file ini','readme.txt    this file');
s=s.replace('recycle bin   sampah','recycle bin   trash');
s=s.replace('settings      wallpaper & opsi','settings      wallpaper & options');
s=s.replace('CATATAN','NOTES');
s=s.replace('Training jaringan & chat jaringan hanya untuk holder $SOLANA.','Network training & network chat are for $SOLANA holders only.');
s=s.replace('Mining tetap terbuka untuk semua orang.','Mining remains open to everyone.');
s=s.replace('Tanpa token = hanya bisa mining + training lokal.','Without the token you can only mine + train locally.');
s=s.replace('Dataset hanya di-host selama job berjalan, lalu dihapus.','Datasets are only hosted while a job is running, then deleted.');
s=s.replace('Node training tidak tahu siapa pengirim job.',"Training nodes don't know who submitted the job.");
s=s.replace('Dataset & model lokal tetap di browser ini.','Local datasets & models stay in this browser.');
// also catch stray Indonesian in toasts/handlers
s=s.replaceAll('Phantom belum terinstall — buka phantom.app','Phantom not installed — open phantom.app');
s=s.replaceAll('MetaMask belum terinstall — buka metamask.io','MetaMask not installed — open metamask.io');
s=s.replaceAll('Phantom belum terinstall','Phantom not installed');
s=s.replaceAll('MetaMask belum terinstall','MetaMask not installed');
s=s.replaceAll('Wajib hold $SOLANA untuk training jaringan — beli di wallet','You must hold $SOLANA for network training — buy in wallet');
s=s.replaceAll('Kredit kurang — mining dulu di miner.exe (butuh ~5 cr)','Not enough credits — mine first in miner.exe (need ~5 cr)');
s=s.replaceAll('Dataset → komputer bertenaga → lapisan tipis LoRA → kembali (dispatch mock ke GPU Node #001)','Dataset → powerful machines → thin LoRA layer → returned (mock dispatch to GPU Node #001)');
fs.writeFileSync('src/main.ts',s);console.log('done3')
// also fix earlier double translation bug
let s2=fs.readFileSync('src/main.ts','utf8');
if(s2.includes('Base model besar + lapisan tipis')){ s2=s2.replaceAll('Base model besar + lapisan tipis LoRA hasil training anda digabung untuThe large base','The large base'); fs.writeFileSync('src/main.ts',s2); console.log('fixed double')}
