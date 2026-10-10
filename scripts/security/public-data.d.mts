export interface PublicDataFinding {
  file: string;
  line: number;
  rule: string;
  blob?: string;
}
export function scanPublicText(source: string, file: string): PublicDataFinding[];
export function scanWorkingTree(): PublicDataFinding[];
export function scanHistory(): PublicDataFinding[];
