export const I_DONT_KNOW = "Sorry, I am not sure how to answer that.";
export const MIN_PROMPT_LENGTH = 10;
export const MIN_CONTENT_LENGTH = 20;
export const MAX_PROMPT_LENGTH = 200;
export const STREAM_SEPARATOR = "___START_RESPONSE_STREAM___";
export const CONTEXT_TOKENS_CUTOFF = 1500;
export const TELEGRAM_FILE_SIZE_LIMIT = 40; // 40 MB
export const TELEGRAM_IMAGE_SIZE_LIMIT = 30; // 30 MB
export const TOKEN_LIMIT = 100000;
export const DOC_SIZE = 1500;
export const ARTICLE_MAX_LENGTH = 100000;
export const EXCLUDE_LINK_LIST = [
  "google",
  "facebook",
  "twitter",
  "instagram",
  "youtube",
  "tiktok",
];

export const MIN_PROMPT_MESSAGE = `
To get the best results from our InsightAI, please provide a minimum prompt length of 10 characters. This will help us generate more accurate and meaningful responses tailored to your needs. Thank you for using InsightAI! 😊`;
export const SCRIBBLE_GENERATION_PROMPT = `Transform this scribble into a visually appealing, detailed image while preserving the original concept and enhancing its artistic expression.`;
export const ROOM_GENERATION_PROMPT = `Design a modern and stylish room that incorporates minimalism, clean lines, and a neutral color palette, while prioritizing functionality, comfort, and natural lighting. The space should feature a mix of textures and materials, including glass, metal, and wood, to create a visually appealing and harmonious atmosphere. Include some statement pieces and greenery to add personality and warmth to the room, making it a welcoming and inviting space for relaxation and socializing`;
export const HELP_MESSAGE = `  
🤖 Insight AI Bot: Help Page 🤖

Welcome to the Insight AI Bot Help Page! Our advanced AI system is here to assist you with a variety of tasks. Below is a list of available commands and their descriptions to help you get started:

1️⃣ /url - Train AI Model with a URL
To train a model using a specific URL, simply type /url followed by the link. For example: /url https://www.example.com. Insight AI will then learn from the content at the specified URL.

2️⃣ /dt - Display Trained Datasets List
Keep track of all the trained datasets by typing /dt. The bot will promptly provide a list of all the datasets you have trained with, including URLs and PDF files.

3️⃣ /limit - Check Rate Limit Information
Stay informed about your usage by typing /limit. Insight AI will display information about your current rate limit and any related restrictions.

4️⃣ /pdf - Train AI Model with a PDF File
To train the AI model using a PDF file, send the command /pdf, followed by a caption and the PDF file itself. Please note that the maximum file size allowed is 50MB.

5️⃣ /scribble - Generate Image from Scribble
Upload an image of your scribble along with the command /scribble. Insight AI will analyze your scribble and create a refined image based on its essence.

6️⃣ /room - Enhance Room Design
Elevate your room's aesthetics with modern design techniques by sending an image of your space along with the command /room. Insight AI will analyze your space and suggest improvements to create a contemporary look.

7️⃣ /restore - Restore Old Photos
Breathe new life into your cherished memories by sending an old, damaged, or faded photograph along with the command /restore. Insight AI will skillfully restore the image, preserving your precious moments.

8️⃣ /imagine - Text to Image Conversion
Experience the power of AI-driven visual storytelling with /imagine. Simply send an image along with a text description, and Insight AI will generate a corresponding image that brings your words to life.

❓ Any Text with a Question Mark
To generate a response to your question, simply type your query followed by a question mark. For example: "What is the weather like today?". Insight AI will process your question and provide a relevant response.

We hope this information helps you make the most of your experience with Insight AI Bot. If you have any further questions, feel free to ask!
`;

export const INVALID_PRICING_PLAN_MESSAGE = `
Oops! It seems like you've selected an invalid pricing plan. 🙁 Please double-check your options and choose a valid plan to continue. If you need assistance, feel free to reach out to our support team. We're here to help! Thanks for using our Telegram bot! 🤖
`;

export const ERROR_GENERATING_EMBEDDINGS_MESSAGE = `
🤖 InsightAI Bot: We have successfully processed most of the content in your file! However, we encountered some issues with certain parts.
`;

export const USER_CREATION_ERROR_MESSAGE = `
⚠️ Oops! We encountered an error while creating your account. We apologize for the inconvenience. Please give it another try later, or reach out to our support team if the issue persists. Thank you for your understanding! 🤖
`;

export const UNABLE_TO_PROCESS_IMAGE_MESSAGE = `
⚠️ Unable to Process Image ⚠️

We regret to inform you that InsightAI is currently unable to process the image you uploaded. We apologize for any inconvenience this may cause. Please try again later, and if the issue persists, feel free to reach out to our support team for assistance. Thank you for your understanding and patience.
`;

export const UNABLE_TO_PROCESS_PDF_MESSAGE = `
⚠️ Unable to Process PDF ⚠️

We regret to inform you that InsightAI is currently unable to process the PDF file you uploaded. We apologize for any inconvenience this may cause. Please try again later, and if the issue persists, feel free to reach out to our support team for assistance. Thank you for your understanding and patience.
`;

export const INTERNAL_SERVER_ERROR_MESSAGE = `
⚠️ Internal Server Error ⚠️

Apologize for the inconvenience, but InsightAI is currently experiencing an internal server error. Our team is working diligently to resolve the issue as soon as possible. Please try again later, and if the issue persists, feel free to reach out to our support team for assistance. Thank you for your understanding and patience.
`;

export const INSUFFICIENT_TOKENS_MESSAGE = `
⚠️ Insufficient Tokens ⚠️

It appears that you may not have enough tokens left to process the content of the uploaded file with InsightAI. To continue using our services without limitations, please consider upgrading to one of our paid plans, which offer additional tokens and features to meet your needs. You can find more information about our plans at /plans. If you have any questions or require assistance, please don't hesitate to reach out to our support team. Thank you for using InsightAI!
`;
export const INSUFFICEINT_IMAGE_GENERATIONS_MESSAGE = `
⚠️ Insufficient Image Generations ⚠️

It seems you don't have enough image generations remaining to process this image.  To continue using our services without limitations, please consider upgrading to one of our paid plans, which offer additional image generations and features to meet your needs. You can find more information about our plans at /plans. If you have any questions or require assistance, please don't hesitate to reach out to our support team. Thank you for using InsightAI!
`;

export const FILE_SIZE_EXCEEDED_MESSAGE = `
⚠️ File Size Exceeded ⚠️

To ensure optimal performance and faster processing, we currently accept files with a maximum size of 40 MB. Please make sure your file is within this limit before sending it to us. We appreciate your understanding and cooperation. If you have any questions or need assistance, feel free to reach out. Happy to help! 😊
`;

export const IMAGE_SIZE_EXCEEDED_MESSAGE = `
⚠️ Image Size Exceeded ⚠️

To ensure optimal performance and faster processing, we currently accept images with a maximum size of 30 MB. Please make sure your image is within this limit before sending it to us. We appreciate your understanding and cooperation. If you have any questions or need assistance, feel free to reach out. Happy to help! 😊
`;
export const WELCOME_MESSAGE = `
🌟 Welcome to Insight AI Bot 🌟

Greetings, and thank you for choosing Insight AI Bot! We're excited to accompany you on your journey through the world of artificial intelligence. Our advanced AI system is designed to assist you with a wide range of tasks, from generating images based on text descriptions to restoring old photos, parsing PDFs, and even answering your questions.

To get started, please take a look at our comprehensive Help Page by typing the command /help. Here, you'll find a detailed list of available commands and their descriptions to ensure a seamless user experience.

We're thrilled to have you on board, and we can't wait to see the amazing things we'll accomplish together! If you have any questions or need assistance along the way, don't hesitate to reach out.`;

export const INVALID_COMMAND_MESSAGE = `
⚠️ Invalid Command or Text ⚠️

It seems you've entered an invalid command or text. Please double-check your input and refer to the /help command for a list of valid commands and their descriptions. If you still need assistance or have any questions, feel free to ask at ${process.env.NEXT_PUBLIC_SUPPORT_EMAIL} !
`;
export const SUPPORT_HELP_MESSAGE = `
Hello! 👋 If you have any questions or need assistance, please don't hesitate to reach out to us. We're here to help! 🌟

You can contact us by sending an email to zairovarsen@gmail.com 📧 Our team will get back to you as soon as possible to provide the support you need.

Have a great day! 😊
`;

export const INVALID_FILE_MESSAGE = `
⚠️ Incorrect File Type ⚠️

The InsightAI bot currently supports processing PDF and image (JPEG, PNG) documents only.

Please upload a PDF file or an image (JPEG, PNG) to get started. If you have any questions or need assistance, use /help command. We're here to help! 😊
`;

export const TERMS_AND_CONDITIONS = `
InsightAI Telegram Bot Terms and Conditions

Last updated: April 12, 2023

Welcome to the InsightAI Telegram Bot! We're excited to have you join our community. Before using our services, please read these Terms and Conditions carefully, as they govern your use of the InsightAI Telegram Bot and its associated services. By accessing or using our bot, you agree to be bound by these Terms and Conditions.

Acceptance of Terms
By using the InsightAI Telegram Bot, you are agreeing to these Terms and Conditions. If you do not agree with any part of these Terms, please discontinue use of our services immediately.

Description of Service
InsightAI Telegram Bot provides artificial intelligence-powered insights and analytics. Our bot helps users make informed decisions based on data analysis and predictions. We provide these services through our Telegram bot interface, which accepts payments via Stripe.

Payments and Subscription
Users can access premium features of the InsightAI Telegram Bot by subscribing to a paid plan. Payments for subscriptions are processed securely through Stripe. All subscription plans are billed in advance and are non-refundable. Please refer to our Refund Policy for more information on refunds.

Refund Policy
All payments for InsightAI Telegram Bot subscriptions are non-refundable. However, we may, at our sole discretion, offer a refund or credit in exceptional circumstances. To request a refund, please contact our support team at zairovarsen@gmail.com.

Privacy
Your privacy is important to us. We encourage you to read our Privacy Policy, which explains how we collect, use, and protect your personal information.

Intellectual Property
All content, including but not limited to text, images, graphics, logos, and software, provided by the InsightAI Telegram Bot, is the property of InsightAI or its content suppliers and is protected by international copyright laws. Unauthorized use of any content is prohibited.

Disclaimer of Warranties
The InsightAI Telegram Bot is provided on an "as-is" and "as-available" basis. We make no warranties or representations, express or implied, regarding the accuracy, completeness, or performance of the bot, its content, or the services provided. Users agree to use the bot at their own risk.

Limitation of Liability
In no event shall InsightAI, its directors, employees, or agents be liable for any direct, indirect, incidental, special, consequential, or punitive damages arising from or in connection with your use of the InsightAI Telegram Bot or its services.

Indemnification
You agree to indemnify, defend, and hold harmless InsightAI, its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses arising from your use of the InsightAI Telegram Bot or violation of these Terms and Conditions.

Changes to Terms and Conditions
InsightAI reserves the right to update or modify these Terms and Conditions at any time without prior notice. It is your responsibility to periodically review these Terms for any changes. Your continued use of the InsightAI Telegram Bot constitutes your acceptance of any changes to the Terms and Conditions.

Governing Law and Jurisdiction
These Terms and Conditions are governed by and construed in accordance with the laws of [Country], and any disputes arising from or relating to these Terms shall be subject to the exclusive jurisdiction of the courts of [Country].

Contact Information
If you have any questions or concerns about these Terms and Conditions or our services, please contact us at zairovarsen@gmail.com.

Thank you for using InsightAI Telegram Bot!
`;

export const PROCESSING_BACKGROUND_MESSAGE = `
🔍 InsightAI is working on your request! Please wait while we analyze the data and generate insights for you. 

We'll notify you as soon as the results are ready. 😊
`;

export const TEXT_GENERATION_MESSAGE = `
🌟 Thank you for submitting your text! Our InsightAI bot can help you with the following tasks: 🌟

🔵 Imagine - Generate an image with Open Journey based on the text description

🔵 Question - Answer your question based on the documents you uploaded

Please choose one of the above options to continue.
`;

export const TEXT_GENERATION_OPTIONS = [
  {
    title: "Imagine",
    description:
      "Generate an image with Open Journey based on the text description",
  },
  {
    title: "Question",
    description: "Answer your question based on the documents you uploaded",
  },
];

export const IMAGE_GENERATION_MESSAGE = `
🌟 Thank you for uploading an image! Our InsightAI bot can help you with the following tasks: 🌟

🔵 Restore - Restore old photos

🔵 Scribble - Generate image from scribble sketch

🔵 Room - Generate a modern room from a photo

Please choose one of the above options to continue.
`;

export const IMAGE_GENERATION_OPTIONS = [
  {
    title: "Restore",
    description: "Restore old photos",
  },
  {
    title: "Scribble",
    description: "Generate image from scribble sketch",
  },
  {
    title: "Room",
    description: "Generate a modern room from a photo",
  },
];

export const GENERATED_IMAGE_MESSAGE = `
🎉 Congratulations! Your image has been successfully processed by InsightAI. Take a look at the generated image above and enjoy the results! 😊
`;

export const IMAGE_GENERATION_ERROR_MESSAGE = `
⚠️ Image Generation Error ⚠️

Oops! We encountered an issue while processing your image. Our team at InsightAI is continuously working to improve our service. Please try again later, or feel free to reach out to our support team if you need any assistance. Thank you for your understanding!`;

export const PRICING_PLANS_MESSAGE = `
🌟 Welcome to InsightAI Pricing Plans 🌟

Find the perfect plan to fuel your creativity 🚀🌈:

🟢 Basic Plan - $9.99:
  🎨 10 image generations
  📚 70,000 tokens

🟡 Pro Plan - $24.99:
  🎨 30 image generations
  📚 350,000 tokens

🔵 Business Plan - $49.99:
  🎨 80 image generations
  📚 1,500,000 tokens
`;

export const PRICING_PLANS = [
  {
    title: "Basic Plan",
    description: `🎉 Basic Plan on InsightAI! 🎉
    
🎨 Image Generations: 10 image generations for creating captivating visuals and discovering new possibilities.
    
📚 Tokens: 70,000 tokens for efficient file processing and seamless interaction with your content.`,
    price: 9.99,
  },
  {
    title: "Pro Plan",
    description: `🎉 Pro Plan on InsightAI! 🎉
    
🎨 Image Generations: 30 image generations for creating captivating visuals and discovering new possibilities.
    
📚 Tokens: 350,000 tokens for efficient file processing and seamless interaction with your content.`,
    price: 24.99,
  },
  {
    title: "Business Plan",
    description: `🎉 Business Plan on InsightAI! 🎉
    
🎨 Image Generations: 80 image generations for creating captivating visuals and discovering new possibilities.
    
📚 Tokens: 1,500,000 tokens for efficient file processing and seamless interaction with your content.`,
    price: 49.99,
  },
];

export const allowedIpRanges = [
  "91.108.4.0/22",
  "91.108.56.0/22",
  "149.154.160.0/20",
  "149.154.164.0/22",
];

export const INITIAL_TOKEN_COUNT = 100000;
export const INITIAL_IMAGE_GENERATION_COUNT = 3;
