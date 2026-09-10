import dns from "node:dns/promises";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface HostResolver {
  lookup(hostname: string): Promise<ResolvedAddress[]>;
}

export const dnsHostResolver: HostResolver = {
  async lookup(hostname: string): Promise<ResolvedAddress[]> {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    return addresses.map((item) => ({
      address: item.address,
      family: item.family as 4 | 6
    }));
  }
};
