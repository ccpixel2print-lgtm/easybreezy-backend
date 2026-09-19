export interface QuoteItemDto {
  name: string;
  description?: string;
  amount: number; // paise, unit price
  quantity?: number; // default 1
}

export interface RaiseQuoteDto {
  items: QuoteItemDto[];
}

export interface EditQuoteDto {
  items: QuoteItemDto[];
}
