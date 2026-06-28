import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Parse DATABASE_URL from .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envFile, 'utf-8');
const dbUrlMatch = envContent.match(/DATABASE_URL="([^"]+)"/);
const databaseUrl = dbUrlMatch ? dbUrlMatch[1] : null;

if (!databaseUrl) {
  console.error('Failed to parse DATABASE_URL from .env');
  process.exit(1);
}

console.log('Connecting to database...');
const pool = new Pool({ connectionString: databaseUrl });

async function run() {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('BLOCK 1: BankSupplementary raw rows for 4 named banks (casa_pct)');
    console.log('='.repeat(70) + '\n');
    
    const block1 = await pool.query(`
      SELECT bs.*, s.symbol
      FROM bank_supplementary bs
      JOIN stocks s ON s.id = bs.stock_id
      WHERE s.symbol IN ('ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'UNIONBANK')
        AND bs.metric = 'casa_pct'
      ORDER BY s.symbol, bs.fiscal_year DESC, bs.quarter DESC, bs.version DESC
    `);
    console.log('Rows found:', block1.rows.length);
    if (block1.rows.length > 0) {
      console.log(JSON.stringify(block1.rows, null, 2));
    } else {
      console.log('(No rows found)');
    }

    console.log('\n' + '='.repeat(70));
    console.log('BLOCK 2: Bank_supplementary table schema inspection');
    console.log('='.repeat(70) + '\n');
    
    const block2 = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'bank_supplementary' 
      ORDER BY ordinal_position
    `);
    console.log('Columns in bank_supplementary:');
    block2.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

    console.log('\n' + '='.repeat(70));
    console.log('BLOCK 3: Check metric enum values in table');
    console.log('='.repeat(70) + '\n');
    
    const block3 = await pool.query(`
      SELECT DISTINCT metric FROM bank_supplementary ORDER BY metric
    `);
    console.log('Distinct metric values:');
    console.log(JSON.stringify(block3.rows, null, 2));

    console.log('\n' + '='.repeat(70));
    console.log('BLOCK 4: All rows from bank_supplementary for the 4 banks');
    console.log('='.repeat(70) + '\n');
    
    const block4 = await pool.query(`
      SELECT bs.id, bs.stock_id, s.symbol, bs.metric, bs.fiscal_year, bs.quarter,
        bs.status, bs.value, bs.version, bs.created_at
      FROM bank_supplementary bs
      JOIN stocks s ON s.id = bs.stock_id
      WHERE s.symbol IN ('ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'UNIONBANK')
      ORDER BY s.symbol, bs.metric, bs.fiscal_year DESC, bs.quarter DESC, bs.version DESC
    `);
    console.log('Total rows found:', block4.rows.length);
    if (block4.rows.length > 0) {
      console.log(JSON.stringify(block4.rows, null, 2));
    }

    console.log('\n' + '='.repeat(70));
    console.log('BLOCK 5: Latest snapshot for 4 banks with scores');
    console.log('='.repeat(70) + '\n');
    
    const block5 = await pool.query(`
      SELECT ss.id, ss.stock_id, s.symbol, ss.period_key, ss.as_of_date, 
        ss.composite, ss.created_at
      FROM score_snapshots ss
      JOIN stocks s ON s.id = ss.stock_id
      WHERE s.symbol IN ('ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'UNIONBANK')
      ORDER BY s.symbol, ss.created_at DESC
      LIMIT 20
    `);
    console.log('Rows found:', block5.rows.length);
    if (block5.rows.length > 0) {
      console.log(JSON.stringify(block5.rows, null, 2));
    }

    console.log('\n' + '='.repeat(70));
    console.log('BLOCK 6: MetricScores for latest snapshots');
    console.log('='.repeat(70) + '\n');
    
    const block6 = await pool.query(`
      SELECT DISTINCT metric_key FROM score_metrics 
      WHERE metric_key ILIKE '%casa%' OR metric_key ILIKE '%F7%'
      ORDER BY metric_key
    `);
    console.log('CASA/F7-like metrics found:', block6.rows.length);
    if (block6.rows.length > 0) {
      console.log(JSON.stringify(block6.rows, null, 2));
    } else {
      console.log('(No CASA/F7 metrics - trying first 10 distinct metrics)');
      const allMetrics = await pool.query(`
        SELECT DISTINCT metric_key FROM score_metrics LIMIT 10
      `);
      console.log(JSON.stringify(allMetrics.rows, null, 2));
    }

    console.log('\n' + '='.repeat(70));
    console.log('BLOCK 7: Full search for any score data on 4 banks');
    console.log('='.repeat(70) + '\n');
    
    const block7 = await pool.query(`
      SELECT sm.metric_key, sm.raw_value, sm.l1_score, sm.l2_score, sm.l3_score, 
        sm.metric_score, ps.source_period, s.symbol
      FROM score_metrics sm
      JOIN score_pillars ps ON ps.id = sm.pillar_score_id
      JOIN stocks s ON s.id = ps.stock_id
      WHERE s.symbol IN ('ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'UNIONBANK')
      ORDER BY s.symbol, sm.metric_key
      LIMIT 100
    `);
    console.log('Score metrics found:', block7.rows.length);
    if (block7.rows.length > 0) {
      console.log(JSON.stringify(block7.rows.slice(0, 30), null, 2));
      if (block7.rows.length > 30) {
        console.log(`... (${block7.rows.length - 30} more rows)`);
      }
    }

  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

await run();
