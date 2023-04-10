import cloudinary from 'cloudinary';

cloudinary.v2.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
  api_secret: process.env.NEXT_PUBLIC_CLOUDINARY_API_SECRET,
});

export async function uploadImage(
    imageUploaded: string
  ): Promise<cloudinary.UploadApiResponse | null> {
    try {
      const upload = await cloudinary.v2.uploader.upload(imageUploaded, {
        folder: "telegram"
      });
      const url = await cloudinary.v2.url(upload.public_id);
      console.log(url);

      return upload;
    } catch (err) {
      console.log(err);
      return null;
    }
  }

  export function deleteImage(
    publicId: string
  ): Promise<cloudinary.DeleteApiResponse> {
    return new Promise((resolve, reject) => {
      cloudinary.v2.uploader.destroy(publicId, (err, res) => {
        if (err) reject(err);
        resolve(res as any);
      });
    });
  }
  
  export function getCloudinaryUrl(publicId: string) {
    return cloudinary.v2.url(publicId);
  }
  export default cloudinary;
  