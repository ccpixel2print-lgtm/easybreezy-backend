export interface CreateCategoryDto {
  name: string;
  displayOrder?: number;
  active?: boolean;
}
export interface UpdateCategoryDto {
  name?: string;
  displayOrder?: number;
  active?: boolean;
}

export interface CreateServiceDto {
  categoryId: string;
  name: string;
  slug?: string;
  description?: string;
  longDescription?: string;
  imageUrl?: string;
  imageAlt?: string;
  hasSubServices?: boolean;
  pricingType?: 'FIXED' | 'HOURLY' | 'VISITING';
  basePrice?: number;      // paise
  hourlyRate?: number;     // paise
  visitFee?: number;       // paise
  durationLabel?: string;
  startingPrice?: number;  // paise
  displayOrder?: number;
  active?: boolean;
}
export type UpdateServiceDto = Partial<CreateServiceDto>;

export interface CreateSubServiceDto {
  serviceId: string;
  name: string;
  pricingType: 'FIXED' | 'HOURLY' | 'VISITING';   // required
  description?: string;
  basePrice?: number;
  hourlyRate?: number;
  visitFee?: number;
  durationLabel?: string;
  displayOrder?: number;
  active?: boolean;
}
export type UpdateSubServiceDto = Partial<Omit<CreateSubServiceDto, 'serviceId'>>;

export interface CreatePincodeDto {
  pincode: string;
  areaName?: string;
  city?: string;
  active?: boolean;
}
export type UpdatePincodeDto = Partial<Omit<CreatePincodeDto, 'pincode'>>;
