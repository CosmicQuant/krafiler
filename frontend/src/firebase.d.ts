// Type stubs for firebase modular SDK — the npm package's .d.ts files are missing.
// If firebase types are restored, this file can be deleted.

declare module 'firebase/auth' {
  export interface User {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    emailVerified: boolean;
    isAnonymous: boolean;
    metadata: any;
    providerData: any[];
    refreshToken: string;
    tenantId: string | null;
    delete(): Promise<void>;
    getIdToken(forceRefresh?: boolean): Promise<string>;
    getIdTokenResult(forceRefresh?: boolean): Promise<any>;
    reload(): Promise<void>;
    toJSON(): object;
  }

  export interface Auth {
    app: any;
    currentUser: User | null;
    onAuthStateChanged(nextOrObserver: (user: User | null) => void, error?: (error: Error) => void, completed?: () => void): () => void;
    signOut(): Promise<void>;
  }

  export class GoogleAuthProvider {
    providerId: string;
    constructor();
    addScope(scope: string): GoogleAuthProvider;
    setCustomParameters(params: Record<string, string>): GoogleAuthProvider;
    static credential(idToken?: string, accessToken?: string): any;
  }

  export function getAuth(app?: any): Auth;
  export function onAuthStateChanged(auth: Auth, nextOrObserver: (user: User | null) => void, error?: (error: Error) => void, completed?: () => void): () => void;
  export function signInWithPopup(auth: Auth, provider: GoogleAuthProvider): Promise<{ user: User }>;
  export function signOut(auth: Auth): Promise<void>;
}

declare module 'firebase/firestore' {
  export interface DocumentData {
    [field: string]: any;
  }

  export interface Timestamp {
    seconds: number;
    nanoseconds: number;
    toDate(): Date;
    toMillis(): number;
    isEqual(other: Timestamp): boolean;
    valueOf(): string;
  }

  export interface QuerySnapshot<T = DocumentData> {
    docs: QueryDocumentSnapshot<T>[];
    empty: boolean;
    size: number;
    forEach(callback: (result: QueryDocumentSnapshot<T>) => void, thisArg?: any): void;
  }

  export interface QueryDocumentSnapshot<T = DocumentData> {
    id: string;
    exists: boolean;
    data(): T;
    get(fieldPath: string): any;
  }

  export interface CollectionReference<T = DocumentData> {
    id: string;
    path: string;
  }

  export interface Query<T = DocumentData> {}

  export function getFirestore(app?: any): any;
  export function collection(firestore: any, path: string, ...pathSegments: string[]): CollectionReference;
  export function query<T>(collection: CollectionReference<T>, ...queryConstraints: any[]): Query<T>;
  export function where(fieldPath: string, opStr: string, value: unknown): any;
  export function onSnapshot<T>(query: Query<T>, onNext: (snapshot: QuerySnapshot<T>) => void, onError?: (error: Error) => void): () => void;
  export function onSnapshot<T>(ref: any, onNext: (snapshot: any) => void, onError?: (error: Error) => void): () => void;
}
