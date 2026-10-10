/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SOLANA_NETWORK: 'devnet'|'testnet'|'mainnet-beta'
  readonly VITE_SOLANA_RPC: string
  readonly VITE_APP_TITLE: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
declare const __APP_MODE__: string
