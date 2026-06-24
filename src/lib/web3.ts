import { defineChain } from "viem";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

export const ritualTestnet = defineChain({
  id: 1979,
  name: "Ritual Chain Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "RITUAL",
    symbol: "RITUAL",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.ritualfoundation.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Ritual Explorer",
      url: "https://explorer.ritualfoundation.org",
    },
  },
  testnet: true,
});

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

export const wagmiConfig = walletConnectProjectId
  ? getDefaultConfig({
      appName: "Ritual Covenant",
      projectId: walletConnectProjectId,
      chains: [ritualTestnet],
      ssr: false,
      transports: {
        [ritualTestnet.id]: http("https://rpc.ritualfoundation.org"),
      },
    })
  : createConfig({
      chains: [ritualTestnet],
      connectors: [injected({ shimDisconnect: true })],
      transports: {
        [ritualTestnet.id]: http("https://rpc.ritualfoundation.org"),
      },
    });
