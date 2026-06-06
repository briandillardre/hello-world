export type GameId = 'trucker-tap' | 'gas-guesser' | 'bathroom-bingo';

export interface RestArea {
  id: string;
  name: string;
  lat: number;
  lng: number;
  state: string;
  country: string;
  highway: string;
  direction?: string;
  amenities: string[];
  funFact: string;
  king?: KingEntry;
  avgRating: number;
  reviewCount: number;
  topReview?: string;
}

export interface KingEntry {
  userId: string;
  username: string;
  score: number;
  since: string;
}

export interface GameScore {
  id: string;
  userId: string;
  username: string;
  gameId: GameId;
  restAreaId: string;
  score: number;
  timestamp: string;
}

export interface Review {
  id: string;
  restAreaId: string;
  userId: string;
  username: string;
  overallRating: number;
  cleanlinessRating: number;
  vendingRating: number;
  vibesRating: number;
  text: string;
  photoEmoji?: string;
  upvotes: number;
  timestamp: string;
}

export interface UserProfile {
  id: string;
  username: string;
  totalScore: number;
  crownCount: number;
  gamesPlayed: number;
  restAreasVisited: string[];
  joinDate: string;
  scores: GameScore[];
  checkIns: CheckIn[];
}

export interface CheckIn {
  restAreaId: string;
  timestamp: string;
  pointsEarned: number;
}

export type RootStackParamList = {
  Main: undefined;
  RestArea: { restAreaId: string };
  Game: { gameId: GameId; restAreaId: string };
  AddReview: { restAreaId: string };
};

export type TabParamList = {
  Map: undefined;
  Leaderboard: undefined;
  Profile: undefined;
};
