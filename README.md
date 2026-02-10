# Jewellery Inventory Manager

A web-based inventory system for jewellery stock using Airtable as the backend database. Search by barcode (Job No.), view details, and update sale status and buyer info from anywhere.

## Features
- Search inventory by barcode (Job No.)
- View all details from Airtable
- Mark as sold, add buyer info, and sale date
- Simple web UI, accessible from any device

## Setup
1. Clone/download this repo.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Create a `.env` file with your Airtable credentials:
   ```env
   AIRTABLE_API_KEY=your_airtable_token
   AIRTABLE_BASE_ID=your_base_id
   AIRTABLE_TABLE_NAME=your_table_name
   ```
4. Start the server:
   ```sh
   npm start
   ```
5. Open http://localhost:3000 in your browser.

## Environment Variables
- `AIRTABLE_API_KEY`: Your Airtable API token
- `AIRTABLE_BASE_ID`: The Base ID of your Airtable base
- `AIRTABLE_TABLE_NAME`: The name of the table with your inventory

## Deployment
- Can be deployed to Heroku, Vercel, or any Node.js host.

## Security
- Never commit your `.env` file or share your API keys publicly.
