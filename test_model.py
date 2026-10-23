import unittest
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('model',Path(__file__).parent.parent/'custom_components/dart_assistant/model.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def match(mid='match_00001',names=('Alpha','Beta')):
    return {'id':mid,'phase':'finished','winner':0,'needed':1,'setsMode':False,'startScore':501,
            'players':[{'name':n,'points':501,'darts':21,'legs':int(i==0),'sets':0,'highestCheckout':100,'bestLeg':21,'hundreds':2,'oneforties':1,'oneeighties':0} for i,n in enumerate(names)]}

class ModelTests(unittest.TestCase):
    def test_completed_and_unique(self):
        d=m.empty_data();x=match();out=m.mutate(d,'match_state',x)
        self.assertEqual(len(out['matches']),1);self.assertEqual(d['matches'],[])
        again=m.mutate(out,'match_state',x);self.assertEqual(len(again['matches']),1)
        bad=match('match_00002');bad['players'][0]['legs']=0
        with self.assertRaises(ValueError):m.mutate(out,'match_state',bad)
        self.assertEqual(len(out['profiles']),2)
    def test_undo_and_redo(self):
        x=match();d=m.mutate(m.empty_data(),'match_state',x)
        d=m.mutate(d,'match_state',{'id':x['id'],'phase':'game'})
        self.assertEqual(len(d['matches']),0)
        self.assertNotIn(x['id'],d['seen'])
        d=m.mutate(d,'match_state',x);self.assertEqual(len(d['matches']),1)
    def test_reset_keeps_profile_and_consistency(self):
        x=match();d=m.mutate(m.empty_data(),'match_state',x);pid=d['profiles'][0]['id']
        d=m.mutate(d,'match_state',match('match_other',('Gamma','Delta')))
        d=m.mutate(d,'reset_player',{'player':pid,'confirm':'reset_player'})
        self.assertEqual(len(d['profiles']),4);self.assertEqual(len(d['matches']),1)
        d=m.mutate(d,'match_state',x);self.assertEqual(len(d['matches']),1)
        d=m.mutate(d,'match_state',{'id':x['id'],'phase':'game'})
        d=m.mutate(d,'match_state',x);self.assertEqual(len(d['matches']),1)
    def test_delete_no_resurrection(self):
        x=match();d=m.mutate(m.empty_data(),'match_state',x);pid=d['profiles'][0]['id']
        d=m.mutate(d,'delete_player',{'player':pid,'confirm':'delete_player'})
        self.assertEqual(len(d['profiles']),1)
        d=m.mutate(d,'match_state',x);self.assertEqual(len(d['profiles']),1)
    def test_pair_reset_preserves_alltime(self):
        d=m.mutate(m.empty_data(),'match_state',match());a,b=[p['id'] for p in d['profiles']]
        out=m.mutate(d,'reset_pair',{'player':a,'opponent':b,'confirm':'reset_pair'})
        self.assertEqual(len(out['matches']),1);self.assertIn(m.pair_key(a,b),out['pair_resets'])
    def test_confirmation_required(self):
        d=m.mutate(m.empty_data(),'match_state',match());pid=d['profiles'][0]['id']
        for action in ('reset_player','delete_player','reset_pair'):
            with self.assertRaises(ValueError):m.mutate(d,action,{'player':pid})
        self.assertEqual(len(d['matches']),1)
    def test_duplicate_names_and_nonfinite(self):
        for names in (('Alpha',' alpha '),('','Beta')):
            with self.assertRaises(ValueError):m.mutate(m.empty_data(),'match_state',match(names=names))
        for n in (float('nan'),float('inf'),-1):
            x=match();x['players'][0]['points']=n
            with self.assertRaises(ValueError):m.mutate(m.empty_data(),'match_state',x)
    def test_settings_limits(self):
        d=m.empty_data()
        with self.assertRaises(ValueError):m.mutate(d,'settings',{'patch':{'startScript':'light.test'}})
        with self.assertRaises(ValueError):m.mutate(d,'settings',{'patch':{'logo':'https://other.example/image.png'}})
        out=m.mutate(d,'settings',{'patch':{'startScript':'script.darts','soundVolume':0}})
        self.assertEqual(out['settings']['soundVolume'],0)
    def test_sets(self):
        x=match();x.update(setsMode=True,needed=2);x['players'][0]['sets']=2
        d=m.mutate(m.empty_data(),'match_state',x);self.assertEqual(d['matches'][0]['players'][0]['sets'],2)

if __name__=='__main__':unittest.main()
