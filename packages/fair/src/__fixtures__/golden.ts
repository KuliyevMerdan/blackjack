/**
 * Golden vectors, computed by an independent implementation — golden/shuffle.py, Python's
 * hashlib and hmac and integer arithmetic, written from docs/protocol.md §3 and not from this
 * package. Server seeds are `SHA256("blackjack-golden-<i>")`. Regenerate, never hand-edit:
 *
 *     python3 golden/shuffle.py > src/__fixtures__/golden.ts
 */

export interface GoldenShoe {
  readonly serverSeed: string;
  readonly clientSeed: string;
  readonly commit: string;
  /** The first 20 cards dealt. */
  readonly top: readonly string[];
}

export const GOLDEN: readonly GoldenShoe[] = [
  {
    serverSeed: '0c6689720cf41bc4e12ab9a703b90c74740ab24934e97e96e762c96b4adee607',
    clientSeed: 'a',
    commit: 'bcab6d82899b8603fc2922da69ba56fc2cbd07ce933aba2e88ee58fac626b7fc',
    top: ['9S', '4D', 'TC', 'TH', 'TS', 'QC', '8H', '5S', '5H', '4C', '3H', '7H', '7H', 'QD', '9C', 'KH', 'TC', '5C', 'AD', 'TH'],
  },
  {
    serverSeed: '881e7741d14033eb9f1ec25410f0b88eaa61bfcda6dd05f8adf248dbb40b8c01',
    clientSeed: '~',
    commit: 'fabc6fc1854d0423950ec5f5b80e269830c8c16a8c7af5067d2835d15b05062f',
    top: ['TC', '2C', '6C', '6D', 'QH', 'AC', 'KH', '9H', 'QS', 'JS', '5D', '5S', '4D', '2S', '3C', 'JC', '8S', '6H', '4D', '6D'],
  },
  {
    serverSeed: 'fd3589f62794c96889d209848fd23b7058502aabf38a78d7fd66b04865f05656',
    clientSeed: ' ',
    commit: '6f5d57561c9d5b06b5d253e1c10a367dabbce7290422268fcd7240db3d8e10df',
    top: ['3S', '2D', 'JD', '2S', 'JH', 'QD', '8C', '3C', '6D', 'KS', 'KC', 'TS', '5H', '9S', '4C', '4C', '3C', '4H', '6H', '5C'],
  },
  {
    serverSeed: '9ddd1edf883869f43fa7245fd89cc7a011919b3d28ab6f0b29d6448741f7fbd0',
    clientSeed: '0',
    commit: '302e298ef4f35cdacd776fe73660e941da863ac78e53429b9c8368d2ba34d8db',
    top: ['2S', '2H', '9D', '8D', '5D', 'AC', 'JD', '9D', 'TD', 'KC', 'TS', '9H', 'TD', '7C', '3H', 'JS', '4D', '5S', '8S', 'KH'],
  },
  {
    serverSeed: 'ae415cc33e2a08464dd506584cd5534016a4dd734501225749022c1cfc1ec3df',
    clientSeed: 'player-seed',
    commit: 'a2798ab255edd7b748216464adb506c00d353e8367f4f9d217a22c73aadfd453',
    top: ['7C', '7H', '2S', '6C', 'TH', 'AD', '7S', 'KD', 'AH', 'JH', 'JH', '6D', '8C', '6H', '5C', '2H', 'AH', '7H', 'JS', 'AD'],
  },
  {
    serverSeed: '52917b3e335b567062e09da2c989f3f4de7a7503df5421cecb75f659a9680808',
    clientSeed: 'client seed with spaces',
    commit: 'a8d5387af90a920cd2eca8587174c4525b0d3b720e6a00a625dde7ffee138563',
    top: ['6S', '5H', '6H', '2H', '2D', 'AS', '9S', '2C', 'KS', '5S', 'KS', '2H', 'KD', 'TC', '2D', 'QD', '5S', '8C', 'TH', 'AC'],
  },
  {
    serverSeed: '70cffb32fdc98ed92839d04e658fe9a1ede750269d2dd69cc626a2f2e4b6eb2e',
    clientSeed: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
    commit: '458c7342060a59c2f6d47198e9979c1e72ca2a0474d5dbc2c2c36871b12b9b09',
    top: ['3S', 'QH', '5D', 'TS', 'TD', 'KH', '5S', '3H', 'TH', '2S', 'AD', 'JD', '2D', 'JD', 'JH', 'JD', '8C', '6D', '7D', 'TC'],
  },
  {
    serverSeed: '7ef5635fa95e8193cabf1a82385dd91e259f1ba44f9d966f5bbdb1ead0dda796',
    clientSeed: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    commit: '0f33054636284e8435eadc92c795f735ac9f7390b51a387a830871f6cc080a4d',
    top: ['2C', '7D', '6C', '6C', 'QS', '9H', 'QH', 'JC', '4S', '7H', '7C', '5S', '7S', '2C', 'QD', 'TH', '6H', '5C', '5C', 'TH'],
  },
  {
    serverSeed: '293d0791d52b2a5897ec91ac31d262c83d0e2cf59d4935a58fe2317d84645cb7',
    clientSeed: '0123456789abcdef0123456789abcdef',
    commit: 'b7f072a4c8f501126769a9e16be9ab83550bac67d2bc8b56588ce1d3141e13d9',
    top: ['QH', '5C', '2C', '5D', '5S', '7C', 'JD', '4D', 'TH', '9H', 'KD', '4C', '3H', '8C', '6D', '3D', 'AS', 'JS', 'AD', 'KC'],
  },
  {
    serverSeed: 'deb1a560c4b56216b4c931e2f00d0ce111f7798692f368ac437f885ab59cc9ac',
    clientSeed: 'The quick brown fox jumps over the lazy dog',
    commit: '31b42721f83d6a4533163a33ddba72ae8ea1cecf96d571b81f92051865037e40',
    top: ['8S', 'JH', 'QC', '4S', 'KD', 'AH', 'QC', '3D', 'QS', 'AD', 'JH', '2H', '9S', '4S', 'TH', 'QH', 'QC', '2C', 'TD', '2D'],
  },
  {
    serverSeed: 'ef41e80fed81b5a76938674377677632554a259861c5d172f136cdd68b824d6b',
    clientSeed: 'a',
    commit: 'd41cb5fe3fd2744af4f6fb0629eadaa0331270cc2c6dedd2aa4a7228bc125dcb',
    top: ['9C', '3C', '6H', '5C', '5C', 'TS', '5D', 'TC', 'QC', '4D', '5H', '3C', '2H', 'AS', '7D', 'JH', 'JH', 'TD', '9C', '3C'],
  },
  {
    serverSeed: '426176bb324d5d795ca4bb0dd9d909d17705528541325c6dbbe7439c97556d1e',
    clientSeed: '~',
    commit: 'd4d6e041f0604a9bbc0b24ba2b3365ca45a58258ae5df2fb01c3fe78d7d2087f',
    top: ['3C', '9H', 'AH', '2D', '4D', 'QC', 'KD', 'TH', '2S', 'QS', '3D', '9S', '6S', 'AH', 'QD', 'TS', '7C', 'TS', '8S', 'JC'],
  },
  {
    serverSeed: '84b5c88cc697fcaac930a7b42f11f7b348613ee3706e7e45ef022ac8a1dfac9b',
    clientSeed: ' ',
    commit: '96d59b9d6825216e6f9f22357c3d41de63b239e02d05445397e0ba8fa62da7de',
    top: ['5C', '3H', '3C', '4D', 'JC', '7C', '5C', '5D', 'AS', 'KS', '3D', '5S', '9D', 'QC', '6S', '2H', 'TD', '3C', 'TH', '4C'],
  },
  {
    serverSeed: '836503cd53fad92baca54adcc49816e470f4f59ce9dd0e047bfb7d15c41c797e',
    clientSeed: '0',
    commit: 'a5ab02ff9a5e45f8c9b780a0e446c2cf9b1bf6f1b6eac5a7a44b78161587fff8',
    top: ['3D', 'KC', 'AD', 'TS', 'AC', 'AH', '5H', 'KD', '2D', 'QH', '7S', '6C', '9C', '5D', 'JH', 'KD', '8H', '5S', '8C', 'QS'],
  },
  {
    serverSeed: '8bb761e4e829c581a0548d685392f80cef8fc3adf63c89cccc71512813fdd8f3',
    clientSeed: 'player-seed',
    commit: '1c3952a81bb7ed33be966ef1e7d6e73bc5318240d92910b6b4cac370f092163a',
    top: ['9D', '3C', 'JS', '4C', '9H', '7H', '3H', '5S', '2C', '9C', '5D', 'QC', '6D', '7S', '8D', 'QS', '9C', '5H', '2C', '6D'],
  },
  {
    serverSeed: '4b05d9dc8b9913a1e23a8d7b974d984b19c1d8e57408b0400dda6c99c6a27aee',
    clientSeed: 'client seed with spaces',
    commit: 'd09d6e3f505cc6973ed7b1c21881f485d9d95702306c09dde7e1036cf774e43e',
    top: ['QH', '6S', '7H', '5D', '7C', 'JH', 'JD', '3C', 'TH', '3H', '6H', 'AD', 'KC', '9D', '4H', 'TS', '2D', 'TH', '2C', '9S'],
  },
  {
    serverSeed: 'a5ab4f2a1783c15dab10362cd86b771574ad679e089446ab33c799cadf33ffbe',
    clientSeed: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
    commit: '0fa41505d81fdeae7a02be628922e803134a9e48a26a7ce363ee07b60a293c1b',
    top: ['7D', 'AC', 'KD', '2S', 'JC', '6D', 'QD', '4D', 'TH', '7D', '7C', '2C', '6S', 'KS', 'JS', '2D', 'TD', '7C', '7H', '6S'],
  },
  {
    serverSeed: '2ba520a10ada8b0dcfb0b5b15de80f64901aaf89c787160962bcb11f1039c96f',
    clientSeed: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    commit: '067b70557856c0eb3edbd3efdbce0c8671bac563ce5f1ec47a27d40dedcf7756',
    top: ['7C', 'KS', 'QC', 'QS', 'TD', '9C', 'QC', 'KC', '3H', '5D', 'QS', '2D', '5C', '6H', '9D', '3D', '2H', 'TD', '4H', '7H'],
  },
  {
    serverSeed: 'e8718b8d56d8858e46ca3d867ce19db62f1419b7721d83e9ae80a9b2565d0926',
    clientSeed: '0123456789abcdef0123456789abcdef',
    commit: '53cdbcfeaee0e76f36d0d235bd55c57dbb05c9ceb88873026311ae3201ce536f',
    top: ['9C', 'KC', '4D', '7H', 'JD', 'TH', 'QC', 'KC', 'TH', 'TS', 'KD', '9S', 'TC', 'QS', 'KS', '4S', '2C', 'TC', '6S', 'TD'],
  },
  {
    serverSeed: 'c356203a33f3447fd72254128d7e02c4f560856e607ba01e1d5790947830b5d6',
    clientSeed: 'The quick brown fox jumps over the lazy dog',
    commit: '9625cde43d6fd0c42631c14a3c5aaecafaea5c0b4f062ba5144741c5f97327f7',
    top: ['JD', 'TS', '9H', '8H', 'JS', '4C', '5H', 'AD', '4H', '4H', 'KS', '3D', '9C', '2D', '8H', 'KC', '4S', 'AS', 'KC', '4H'],
  },
  {
    serverSeed: 'b9d4edaeb942d3d07fcdbc0ced50f12491d24fd7d3a4b3ce08ba5249b74eb47a',
    clientSeed: 'seed-20',
    commit: '3f8696af51a46ce5f1e2c0ce32fc7ef10562233d5828fd0515c28902219ab6b0',
    top: ['9C', '6S', 'AS', '8H', '2H', 'TD', 'JC', 'AD', 'TC', '5H', '8S', 'QS', '7C', '3C', '3C', 'AS', '4D', '8C', 'JC', 'TH'],
  },
  {
    serverSeed: '5736ba2181d9d4318292ca45265e264131ee91cfbf05d40d21d8e364b400c7d3',
    clientSeed: 'seed-21',
    commit: 'ebf21883cd4a4ce1a2186668e9535019623717a9bc97f615bb1960ed98072666',
    top: ['3S', 'QC', 'QS', 'AS', '9C', '5D', 'QC', 'KH', '5D', '5H', '8D', '5C', 'JS', '7S', '7C', 'QS', '4S', '8C', '9H', '3S'],
  },
  {
    serverSeed: '6d54a5b20961732ebd2fc0d92b27bb254ffc0b4cc1b085b550d76057178b4dd4',
    clientSeed: 'seed-22',
    commit: 'a3da5c851e05eafde869e6eab5495058c3cf382c9ba08d937ac93b2fe4b84182',
    top: ['AS', 'TH', 'KS', '3C', 'JD', 'AC', '5S', 'QC', 'QC', '5C', 'TD', '8D', '7C', 'AC', '9H', '4S', '4H', 'QS', '6C', 'TS'],
  },
  {
    serverSeed: 'f0d9ed28f2d6943316bfcc6fc975db4a547f771295d498d0c9669f639f7fccf5',
    clientSeed: 'seed-23',
    commit: '9c1fd48a367e4fbb12f64b69503de8ad5ca1ebc00e3d699f86234e674cfbd1bd',
    top: ['5H', 'QD', '3S', '9D', '6S', '9C', '7D', '6D', '8H', '8C', 'AS', '3S', '7D', '6S', '2D', '2S', '4S', 'AD', 'QC', '3H'],
  },
  {
    serverSeed: 'd0638378a5cb84ddf9332e062cf83ac34ee2c0c8d44226a128c98733a8dd36b3',
    clientSeed: 'seed-24',
    commit: '865ba831d42eac07443bf17d98c0bc284810f9c40e70dd57199c31e9ceb92066',
    top: ['QD', '3S', '2H', '7H', 'TC', 'JD', '3D', 'QC', '7H', '8H', '3D', 'JS', '6S', '3C', 'AH', '6C', '6D', '5D', '2H', '2C'],
  },
  {
    serverSeed: 'b275b2e95dab01da441f4d8d6ad582295f7e32503242897201e0b2ab6aaca7b2',
    clientSeed: 'seed-25',
    commit: '0927905aa6b3aced7eb51bcf15f3169ba348633a0b7e7f7550705285f9578784',
    top: ['AD', '7D', '5H', 'AC', '6H', 'QD', '3D', 'AC', 'KS', 'JD', 'TH', '3D', '8D', 'KC', 'TC', '2D', '9C', 'QC', '7H', '7D'],
  },
  {
    serverSeed: 'f7cdfcff337bbaba4a2933a7c7f55bb890f449c865da9818a5d9416d7db999a0',
    clientSeed: 'seed-26',
    commit: '6f10933c8382c32ce507fbcb7c2183aca283a22d65c7af0c50381ddbb6c9af2f',
    top: ['TS', 'QH', '3S', '6C', 'JS', '4C', '9D', '4D', 'TD', '4H', 'KD', 'JH', '8C', '2H', 'QD', 'JC', '5S', 'JC', '3C', '2H'],
  },
  {
    serverSeed: 'ff286965699923fe9b4e70dc7f826fde0ebaf852bfc0a587a590ef661ea41411',
    clientSeed: 'seed-27',
    commit: '86df57ea0d36d048b78bebf67327456278c240472c16c4ce49455df75d547da0',
    top: ['5S', '2D', 'AS', '3D', '3C', '6C', 'JH', 'TS', '2S', '4C', 'KS', 'KH', 'KD', 'JC', 'TD', '3H', '4C', '5S', '8H', '8C'],
  },
  {
    serverSeed: '1303f84d00111b8e36d25d4571bd6b842f2fbfb76af19a4bfce908aecae7b799',
    clientSeed: 'seed-28',
    commit: '52694573d918439866d08f2a57862c79d590a786606347d976232f49b4fcab0a',
    top: ['3D', 'AC', 'TD', '6S', 'KH', 'TC', 'QD', 'AH', '9D', '2H', 'KS', '9D', 'QD', '8H', 'TH', '6D', '9C', '2S', 'KD', '9H'],
  },
  {
    serverSeed: '556c94b226d20c3481397674b90588d237f212f275be5552bd0a03f8e7d2f93e',
    clientSeed: 'seed-29',
    commit: '2702f7c75497946fc5663623f913f9c849fb15aabe791b90d9f1482e403995c3',
    top: ['3H', '3S', '8C', '8C', 'AS', 'JS', '9S', '7D', 'JD', 'QC', '2C', 'QS', '7S', '3H', '2C', '6C', '7S', '8S', '2C', 'TS'],
  },
];

/** The whole 312-card shoe for `GOLDEN[0]` — every position, not only the top. */
export const GOLDEN_FULL: readonly string[] = [
  '9S', '4D', 'TC', 'TH', 'TS', 'QC', '8H', '5S', '5H', '4C', '3H', '7H', '7H',
  'QD', '9C', 'KH', 'TC', '5C', 'AD', 'TH', '8S', '4C', '8H', '3H', '4H', '9S',
  '7C', '8H', 'AC', '3D', 'KS', '9S', '2H', 'TS', '6S', '6H', 'QD', '6H', '3D',
  '8S', '6D', '4H', '4C', '4S', 'AC', '7H', '9D', 'AD', 'QH', 'KC', '8D', 'JC',
  '9H', 'JC', '7S', 'QS', '4D', 'KD', 'AH', 'QC', '6S', 'JS', '3C', '7H', '7S',
  '2S', 'TD', 'JC', '3D', '2H', '5C', '6H', 'TC', '8H', '8C', 'KH', 'TC', '4C',
  '9H', 'KS', '4D', 'AD', 'AC', '7D', 'JS', 'AC', '4C', '6C', '8S', 'TC', '8C',
  '7C', 'QH', 'AH', '4D', 'QC', '8D', '2D', 'QD', '9S', '4C', '5H', 'QH', 'AD',
  'AH', 'TH', 'JC', '9D', 'JD', 'JH', '5S', '6H', '6H', '3C', '5H', 'KD', '2C',
  '9D', '6D', '6D', '2D', '6D', '8S', 'AS', '2S', '5D', '5C', 'TD', '2D', 'AC',
  '5D', 'TS', '5D', 'KH', '4S', '9S', '7C', '3H', '8D', 'QC', 'TS', 'QS', 'KS',
  '4H', '2S', '4S', '8S', '9H', 'KS', '7H', 'AS', '4S', 'JS', '6C', '5D', '3S',
  'JD', 'KD', '6C', '3C', 'JH', '3C', 'AS', 'KD', 'TD', 'TD', '8C', '6C', '4S',
  '4H', '2H', 'QD', '6S', '9H', 'TC', 'TD', '7C', '2C', '9C', 'QH', 'KC', 'JD',
  'AH', '2S', '2S', '8S', '9S', '3S', '3S', 'AH', '7D', 'JD', '4D', 'KC', 'JH',
  'JH', 'KH', 'KD', 'QC', 'KC', '9H', 'QS', '6S', '8C', '3S', '3H', '5S', '9C',
  'TS', 'QH', '3C', '8C', '6H', '2D', 'JH', '5D', '5C', '2D', '5S', '6D', 'KC',
  '2H', 'KH', '5C', 'KS', 'JS', 'TD', '9D', '6S', 'JH', '3S', '6C', 'QS', 'AD',
  '3D', 'JS', '3H', 'JC', 'QS', '9C', '2S', '9C', 'JD', '5H', 'KS', '6S', '2C',
  '7H', '6C', '4S', '2H', 'KC', '4H', '8D', 'AC', '8H', 'KH', '3S', '9D', 'AD',
  '7D', '2D', '2C', '7C', '9D', '8D', '3H', '7S', 'QD', '7S', 'JD', 'QH', '8D',
  'AS', '3D', '4H', 'KD', '9C', '7S', 'TS', '7D', '2H', 'JC', '8H', '5H', 'QD',
  '7D', '6D', 'QC', 'AS', '5D', '2C', 'AH', '7D', '5S', 'QS', '4D', 'TH', '5H',
  'JS', '7C', '5S', '9H', '2C', '7S', '3D', 'TH', '5C', 'AS', 'TH', '8C', '3C',
];
